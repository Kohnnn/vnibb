"""The migration gate must refuse BEFORE `upgrade head`, not report afterwards.

Real Alembic output is used on purpose. `alembic current` prints a bare revision
when the applied revision is not a head and only appends " (head)" when it is, so
a fake "current" that always ends in " (head)" cannot show whether the gate reads
an applied ancestor as an empty database. Each test builds a real two-revision
project, applies a real revision, and lets the script read genuine output.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "oracle" / "verify-migration-head.sh"

OLD = "a1b2c3d4e5f6"
NEW = "b2c3d4e5f6a7"

# The script reads heads/current through one docker command; this stand-in runs the
# real Alembic against the real project so the parsed text is genuine. The shebang
# must be this interpreter: `/usr/bin/env python3` is often a Python without Alembic.
FAKE_DOCKER = '''#!{python}
import os, subprocess, sys
sub = sys.argv[-1]
project = os.environ["FAKE_ALEMBIC_PROJECT"]
result = subprocess.run(
    [sys.executable, "-m", "alembic", "-c", os.path.join(project, "alembic.ini"), sub],
    cwd=project, capture_output=True, text=True,
    env={{"PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
          "FAKE_ALEMBIC_DB": os.environ["FAKE_ALEMBIC_DB"]}},
)
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
'''


@pytest.fixture()
def project(tmp_path):
    root = tmp_path / "proj"
    (root / "migrations" / "versions").mkdir(parents=True)
    (root / "alembic.ini").write_text("[alembic]\nscript_location = migrations\n")
    (root / "migrations" / "env.py").write_text(textwrap.dedent("""
        import os
        from alembic import context
        from sqlalchemy import create_engine
        config = context.config
        engine = create_engine(os.environ["FAKE_ALEMBIC_DB"])
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=None)
            with context.begin_transaction():
                context.run_migrations()
    """))
    (root / "migrations" / "script.py.mako").write_text(
        '"""${message}"""\nrevision = ${repr(up_revision)}\n'
        "down_revision = ${repr(down_revision)}\n"
        "branch_labels = ${repr(branch_labels)}\ndepends_on = ${repr(depends_on)}\n"
        "def upgrade(): pass\ndef downgrade(): pass\n"
    )
    for revision, parent in ((OLD, None), (NEW, OLD)):
        (root / "migrations" / "versions" / f"{revision}.py").write_text(
            f'revision = "{revision}"\ndown_revision = {parent!r}\n'
            "def upgrade(): pass\ndef downgrade(): pass\n"
        )
    return root


def run(tmp_path, project, at_revision=None, approved=NEW, approved_from="none"):
    """Run the gate; `at_revision` is applied first with a real `alembic upgrade`."""
    db = tmp_path / "db.sqlite"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER.format(python=sys.executable))
    docker.chmod(0o755)

    env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "FAKE_ALEMBIC_PROJECT": str(project),
        "FAKE_ALEMBIC_DB": f"sqlite:///{db}",
        "COMPOSE_FILE": "/dev/null",
        "ENV_FILE": "/dev/null",
    }
    if approved is not None:
        env["APPROVED_ALEMBIC_HEAD"] = approved
    if approved_from is not None:
        env["APPROVED_ALEMBIC_FROM"] = approved_from

    # The setup `alembic stamp`/`upgrade` runs use the same env as the gate.
    subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "stamp", "base"],
                   cwd=project, env=env, check=True,
                   capture_output=True, text=True)
    if at_revision:
        subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini",
                        "upgrade", at_revision],
                       cwd=project, env=env, check=True,
                       capture_output=True, text=True)

    return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)


def test_applied_ancestor_is_refused_not_read_as_empty(tmp_path, project):
    """The regression: a real bare applied revision must not look like 'nothing applied'."""
    result = run(tmp_path, project, at_revision=OLD)
    assert result.returncode == 1, result.stdout
    assert f"'{OLD}'" in result.stderr
    assert "no applied revision" not in result.stdout


def test_approved_from_to_transition_passes(tmp_path, project):
    result = run(tmp_path, project, at_revision=OLD, approved_from=OLD)
    assert result.returncode == 0, result.stderr
    assert f"{OLD} -> {NEW}" in result.stdout


def test_fresh_database_passes_only_when_from_is_none(tmp_path, project):
    result = run(tmp_path, project, at_revision=None, approved_from="none")
    assert result.returncode == 0, result.stderr


def test_fresh_database_is_refused_when_approved_from_is_a_revision(tmp_path, project):
    result = run(tmp_path, project, at_revision=None, approved_from=OLD)
    assert result.returncode == 1
    assert "no applied revision" in result.stderr


def test_ancestor_is_refused_when_approved_from_is_none(tmp_path, project):
    result = run(tmp_path, project, at_revision=OLD, approved_from="none")
    assert result.returncode == 1
    assert "starts from an empty database" in result.stderr


def test_database_already_at_candidate_head_is_refused(tmp_path, project):
    result = run(tmp_path, project, at_revision=NEW, approved_from=OLD)
    assert result.returncode == 1
    assert "not the approved starting revision" in result.stderr


def test_code_only_release_at_the_approved_head_is_a_verified_noop(tmp_path, project):
    """An ordinary release already at the head must pass, not trip a guard."""
    result = run(tmp_path, project, at_revision=NEW, approved=NEW, approved_from=NEW)
    assert result.returncode == 0, result.stderr
    assert "no-op release" in result.stdout
    assert NEW in result.stdout


def test_equal_from_and_head_still_requires_the_database_to_match(tmp_path, project):
    """FROM == HEAD is not a bypass: a database elsewhere is still refused."""
    result = run(tmp_path, project, at_revision=OLD, approved=NEW, approved_from=NEW)
    assert result.returncode == 1
    assert "not the approved starting revision" in result.stderr


def test_unreviewed_new_head_is_refused_while_database_is_unchanged(tmp_path, project):
    """A candidate that bumps the head must not reach `upgrade head`."""
    result = run(tmp_path, project, at_revision=OLD, approved=OLD, approved_from="none")
    assert result.returncode == 1
    assert "is not the approved head" in result.stderr
    assert "upgrade" not in result.stdout


def test_missing_approved_head_is_a_hard_error(tmp_path, project):
    result = run(tmp_path, project, at_revision=OLD, approved=None)
    assert result.returncode != 0
    assert "APPROVED_ALEMBIC_HEAD" in result.stderr


def test_missing_approved_from_is_a_hard_error(tmp_path, project):
    result = run(tmp_path, project, at_revision=OLD, approved_from=None)
    assert result.returncode != 0
    assert "APPROVED_ALEMBIC_FROM" in result.stderr


@pytest.mark.parametrize("approved", ["", "a b", "abc\nxyz", " head*", "abc"])
def test_a_non_revision_approved_head_is_rejected(tmp_path, project, approved):
    result = run(tmp_path, project, at_revision=OLD, approved=approved)
    assert result.returncode in {1, 2}


@pytest.mark.parametrize("approved_from", ["", "a b", "abc"])
def test_a_non_revision_approved_from_is_rejected(tmp_path, project, approved_from):
    result = run(tmp_path, project, at_revision=OLD, approved_from=approved_from)
    # Empty hits the `: "${VAR:?}"` unset guard (exit 1); a malformed id exits 2.
    assert result.returncode in {1, 2}
