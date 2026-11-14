"""The migration gate must refuse BEFORE `upgrade head`, not report afterwards.

A fake `docker` answers `alembic heads` and `alembic current` so no image, daemon
or database is needed. The script under test is the release gate that runs before
any migration is applied.
"""

import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "oracle" / "verify-migration-head.sh"
APPROVED = "b8f2c5d91e40"
FAKE_DOCKER = r'''#!/usr/bin/env python3
"""Answer only the two alembic reads verify-migration-head.sh performs."""
import os
import sys

args = sys.argv[1:]
# Keep only what follows the `migrate` service name: the alembic subcommand.
if "migrate" in args:
    args = args[args.index("migrate") + 1:]
else:
    sys.stderr.write("no migrate service in arguments\n")
    raise SystemExit(3)
command = [a for a in args if a not in {"-c", "/app/alembic.ini"}]
if "heads" in command:
    for line in os.environ.get("FAKE_HEADS", "").splitlines():
        if line.strip():
            sys.stdout.write(line.strip() + " (head)\n")
elif "current" in command:
    for line in os.environ.get("FAKE_CURRENT", "").splitlines():
        if line.strip():
            sys.stdout.write(line.strip() + " (head)\n")
else:
    sys.stderr.write("unexpected alembic command\n")
    raise SystemExit(3)
'''


def run(tmp_path, heads, current, approved=APPROVED):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "docker"
    fake.write_text(FAKE_DOCKER)
    fake.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "DOCKER_BIN": "docker",
    }
    if approved is not None:
        env["APPROVED_ALEMBIC_HEAD"] = approved
    if heads is not None:
        env["FAKE_HEADS"] = heads
    if current is not None:
        env["FAKE_CURRENT"] = current
    return subprocess.run(
        ["bash", str(SCRIPT)], env=env, text=True, capture_output=True, check=False
    )


def test_unreviewed_new_head_is_refused_while_database_is_still_unchanged(tmp_path):
    """The regression: a candidate that bumps the head must not reach `upgrade head`."""
    result = run(tmp_path, heads="c0ffee123456", current=APPROVED)
    assert result.returncode == 1
    assert "is not the approved head" in result.stderr
    assert "unreviewed migration" in result.stderr
    # Nothing about applying it was attempted.
    assert "upgrade" not in result.stdout


def test_matching_candidate_and_database_head_passes(tmp_path):
    result = run(tmp_path, heads=APPROVED, current=APPROVED)
    assert result.returncode == 0, result.stderr
    assert "both at approved head" in result.stdout


def test_fresh_database_with_matching_head_passes(tmp_path):
    result = run(tmp_path, heads=APPROVED, current="")
    assert result.returncode == 0, result.stderr
    assert "no applied revision" in result.stdout


def test_database_behind_the_approved_head_is_refused(tmp_path):
    result = run(tmp_path, heads=APPROVED, current="aaaaaaaaaaaa")
    assert result.returncode == 1
    assert "not the approved head" in result.stderr


def test_multiple_heads_are_refused(tmp_path):
    result = run(tmp_path, heads=f"{APPROVED}\ndeadbeef0001", current=APPROVED)
    assert result.returncode == 1
    assert "multiple heads" in result.stderr


def test_unreadable_candidate_heads_fail_closed(tmp_path):
    assert run(tmp_path, heads="", current=APPROVED).returncode == 1


@pytest.mark.parametrize("approved", ["", "a b", "abc\nxyz", " head*"])
def test_a_non_revision_approved_head_is_rejected(tmp_path, approved):
    result = run(tmp_path, heads=APPROVED, current=APPROVED, approved=approved)
    assert result.returncode in {1, 2}
    assert not result.returncode == 0


def test_missing_approved_head_is_a_hard_error(tmp_path):
    result = run(tmp_path, heads=APPROVED, current=APPROVED, approved=None)
    assert result.returncode != 0
    assert "APPROVED_ALEMBIC_HEAD" in result.stderr
