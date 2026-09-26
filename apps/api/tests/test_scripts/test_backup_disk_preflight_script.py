"""Exercise the OCI backup producer without a real Docker daemon or database.

The script's job is to refuse to start when the node cannot hold another set,
to write each artifact exactly once, and to remove only what it created. Each
test drives one of those contracts through a fake `docker` and a fake
`pg_restore` on PATH plus synthetic free-space and size answers, so no Docker,
Postgres, Mongo or 10 GB of disk is needed.
"""

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest


class _Completed:
    """The few CompletedProcess attributes the tests use, with text output."""

    def __init__(self, returncode, stdout, stderr):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "oracle" / "vnibb-backup.sh"
REAL_SET_BYTES = 9895265236  # the 20260924T175056Z paired set's Postgres dump
GIB = 1024**3
MINUTE_AVAILABLE = 64 * 1024**2
ROOMY_AVAILABLE = 400 * GIB
PREV_STAMP = "20250101T000000Z"
SECRET = "hunter2-not-a-real-secret"

FAKE_DOCKER = r'''#!/usr/bin/env python3
"""Stand-in for the docker CLI calls vnibb-backup.sh makes."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

state_file = Path(os.environ["FAKE_DOCKER_STATE"])
state = json.loads(state_file.read_text())
argv = sys.argv[1:]
state["commands"].append(argv)
state_file.write_text(json.dumps(state))

if not argv:
    sys.exit(1)

verb = argv[0]
if verb == "inspect":
    assert argv[1:3] == ["--format", "{{.State.Running}}"]
    container = argv[3]
    if container not in state["containers_present"]:
        sys.exit(1)
    print("true" if container in state["containers_running"] else "false")
    sys.exit(0)
if verb == "info":
    print("/var/lib/docker")
    sys.exit(0)
if verb == "cp":
    if state["copy_fails"]:
        sys.exit(1)
    blob = bytes(state["mongo_archive_bytes"])
    if state["staged_archive_short"]:
        blob = blob[:-1024]
    Path(argv[2]).write_bytes(blob)
    sys.exit(0)

assert verb == "exec", argv
rest = argv[1:]
while rest and rest[0].startswith("-"):  # -i
    rest = rest[1:]
container, command = rest[0], rest[1:]

if command[0] == "printenv":
    if command[1] == "MONGO_INITDB_ROOT_USERNAME":
        print("root")
    elif command[1] == "MONGO_INITDB_ROOT_PASSWORD":
        print(state["mongo_password"])
    sys.exit(0)

if command[0] == "sh" and command[1] == "-c":
    script = command[2]
    if "TMPDIR" in script:
        print("/tmp")
        sys.exit(0)
    if "POSTGRES_DATA_DIR" in script:
        sys.exit(0)  # unset: the producer defaults to /var/lib/postgresql/data
    raise AssertionError(script)

if command[0] == "df":
    assert command[:2] == ["df", "-Pk"], command
    operand = command[2]
    key = "pg" if container == "vnibb-db" else "mongo"
    if "postgresql" in operand or operand == "/data/db":
        key += "_data"
    if key in state["df_fails"]:
        sys.exit(1)
    available = state["available"][key]
    if isinstance(available, str):
        print(available)
    else:
        blocks = available // 1024
        total = blocks + 100
        if state["df_format"] == "busybox":
            print("Filesystem           1024-blocks      Used Available Capacity Mounted on")
            print(f"overlay               {total:>9}       100 {blocks:>9}       1% {operand}")
        else:
            print("Filesystem     1024-blocks  Used Available Capacity Mounted on")
            print(f"overlay          {total:>9}   100 {blocks:>9}      1% {operand}")
    sys.exit(0)

if command[0] == "stat":
    # `docker exec C stat -c %s <path>`: the container always holds the complete
    # archive, so this reports the full size. Only the copy out can be short,
    # which is exactly what the script compares this against.
    print(len(state["mongo_archive_bytes"]))
    sys.exit(0)

if command[0] == "rm":
    sys.exit(1 if state["staging_removal_fails"] else 0)

if command[0] == "pg_restore":
    assert container == "vnibb-db" and "--list" in command
    print("1; 0 0 TABLE DATA public stocks postgres")
    print("2; 0 0 TABLE DATA public stock_prices postgres")
    sys.exit(0)

if command[0] == "pg_dump":
    with Path(state["pg_dump_path"]).open("rb") as payload:
        shutil.copyfileobj(payload, sys.stdout.buffer, length=1024 * 1024)
    sys.stdout.buffer.flush()
    sys.exit(1 if state["pg_dump_fails"] else 0)

if command[0] == "mongodump":
    sys.exit(1 if state["mongodump_fails"] else 0)

raise AssertionError(command)
'''



def _pg_dump_payload(size, header=True):
    """Synthetic `pg_dump -Fc` output: a real PGDMP header, then padding."""
    if not header:
        return b"\x00" * size
    prefix = b"PGDMP\x82~vnibb17.6" + b"\x00" * 32
    return prefix + b"\x00" * max(size - len(prefix), 0)


@pytest.fixture
def run_backup(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    compose = tmp_path / "docker-compose.oracle.yml"
    compose.write_text("services: {}\n", encoding="utf-8")

    def run(
        *,
        available=None,
        containers_present=("vnibb-db", "vnibb-mongo"),
        containers_running=("vnibb-db", "vnibb-mongo"),
        df_format="busybox",
        df_fails=(),
        pg_dump_fails=False,
        pg_dump_bytes=None,
        mongodump_fails=False,
        copy_fails=False,
        staging_removal_fails=False,
        staged_archive_short=False,
        keep_sets=7,
        host_free_bytes=None,
        prune_fails=False,
    ):
        if pg_dump_bytes is None:
            pg_dump_bytes = _pg_dump_payload(12 * 1024**2)
        pg_dump_path = tmp_path / "pg-dump.bin"
        pg_dump_path.write_bytes(pg_dump_bytes)
        state = {
            "commands": [],
            "containers_present": containers_present,
            "containers_running": containers_running,
            "df_format": df_format,
            "df_fails": df_fails,
            "pg_dump_fails": pg_dump_fails,
            "pg_dump_path": str(pg_dump_path),
            "mongodump_fails": mongodump_fails,
            "copy_fails": copy_fails,
            "staging_removal_fails": staging_removal_fails,
            "staged_archive_short": staged_archive_short,
            "mongo_archive_bytes": list(b"\x1f\x8b" + b"\x00" * 4096),
            "mongo_password": SECRET,
            "available": {
                "pg": ROOMY_AVAILABLE,
                "pg_data": ROOMY_AVAILABLE,
                "mongo": ROOMY_AVAILABLE,
                "mongo_data": ROOMY_AVAILABLE,
                **(available or {}),
            },
        }
        state_file = tmp_path / "docker-state.json"
        state_file.write_text(json.dumps(state), encoding="utf-8")
        if prune_fails:
            rm = bin_dir / "rm"
            rm.write_text(
                '#!/bin/sh\ncase "$*" in *20250102T000000Z*) exit 42;; esac\nexec /bin/rm "$@"\n',
                encoding="utf-8",
            )
            rm.chmod(0o755)

        env = os.environ.copy()
        env.update(
            {
                "BACKUP_DIR": str(backup_dir),
                "COMPOSE_FILE": str(compose),
                "ENV_FILE": str(tmp_path / "missing.env"),
                "KEEP_SETS": str(keep_sets),
                "FAKE_DOCKER_STATE": str(state_file),
                "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}",
            }
        )
        if host_free_bytes is not None:
            env["HOST_FREE_BYTES_OVERRIDE"] = str(host_free_bytes)
        # text=False: the fake pg_dump writes PGDMP bytes to stdout, which the
        # script redirects into the dump file. Decoding that pipe as text
        # would fail before any assertion ran.
        proc = subprocess.run(
            ["bash", str(SCRIPT)], env=env, capture_output=True, check=False
        )
        result = _Completed(
            proc.returncode,
            proc.stdout.decode("utf-8", "replace"),
            proc.stderr.decode("utf-8", "replace"),
        )
        return result, json.loads(state_file.read_text())["commands"], backup_dir

    # Tests that need to prepare sets before the run reach the directory here,
    # without running the script just to create it.
    run.backup_dir = backup_dir
    return run


def _sets(backup_dir):
    return sorted(p.name for p in backup_dir.iterdir() if p.is_dir())


def _calls(commands, needle):
    return [" ".join(cmd) for cmd in commands if needle in " ".join(cmd)]


def _make_previous_set(backup_dir, stamp, pg_bytes=REAL_SET_BYTES, usable=True):
    set_dir = backup_dir / stamp
    set_dir.mkdir(parents=True, exist_ok=True)
    dump = set_dir / f"postgres-{stamp}.dump"
    dump.write_bytes(b"previous dump")
    mongo = set_dir / f"mongo-vnibb-market-{stamp}.archive.gz"
    mongo.write_bytes(b"previous mongo")
    manifest = {
        "stamp": stamp,
        "postgres": {"database": "vnibb" if usable else "postgres", "tables": 87},
        "mongo": {"database": "vnibb-market", "included": True},
        "artifacts": {}
        if not usable
        else {
            dump.name: {"bytes": pg_bytes, "sha256": "0" * 64},
            mongo.name: {"bytes": mongo.stat().st_size, "sha256": "0" * 64},
        },
    }
    (set_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return set_dir


# --- disk preflight: the incident -------------------------------------------


def test_insufficient_host_disk_fails_before_creating_anything(run_backup):
    """The incident: a full root disk must stop the run, not truncate a dump."""
    result, commands, backup_dir = run_backup(
        host_free_bytes=MINUTE_AVAILABLE,
        available={"pg": MINUTE_AVAILABLE, "pg_data": MINUTE_AVAILABLE},
    )

    assert result.returncode != 0
    assert "insufficient host disk" in result.stderr
    assert _sets(backup_dir) == []
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")


def test_preflight_issues_no_database_write_and_no_container_run(run_backup):
    result, commands, _ = run_backup(host_free_bytes=MINUTE_AVAILABLE)

    assert result.returncode != 0
    for cmd in commands:
        assert cmd[0] != "run", cmd
        assert "psql" not in cmd, cmd
        assert "mongosh" not in cmd, cmd


def test_failed_preflight_marks_failed_but_keeps_previous_sets(run_backup):
    result, _, backup_dir = run_backup()
    assert result.returncode == 0, result.stderr
    (kept,) = _sets(backup_dir)

    result, _, _ = run_backup(host_free_bytes=MINUTE_AVAILABLE)

    assert result.returncode != 0
    assert _sets(backup_dir) == [kept]
    markers = list(backup_dir.glob("*.FAILED"))
    assert len(markers) == 1
    payload = json.loads(markers[0].read_text())
    assert payload["status"] == "failed"
    assert "insufficient host disk" in payload["reason"]


def test_host_requirement_is_sized_from_the_last_successful_set(run_backup):
    """A previous dump must reserve growth margin plus free host headroom."""
    backup_dir = run_backup.backup_dir
    _make_previous_set(backup_dir, PREV_STAMP, pg_bytes=REAL_SET_BYTES)
    # 12 GiB cannot fit the measured dump with growth margin and host reserve.
    avail = 12 * GIB
    result, commands, _ = run_backup(
        host_free_bytes=avail,
        available={"pg": avail, "pg_data": avail, "mongo": avail, "mongo_data": avail},
    )

    assert result.returncode != 0
    assert "insufficient host disk" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == [PREV_STAMP]


def test_unusable_previous_manifest_falls_back_to_the_floor(run_backup):
    """A damaged previous set must raise the demand, never lower it."""
    backup_dir = run_backup.backup_dir
    _make_previous_set(backup_dir, PREV_STAMP, usable=False)
    avail = 12 * GIB
    result, commands, _ = run_backup(
        host_free_bytes=avail,
        available={"pg": avail, "pg_data": avail, "mongo": avail, "mongo_data": avail},
    )

    assert result.returncode != 0
    assert "insufficient host disk" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == [PREV_STAMP]

def test_postgres_container_temp_exhaustion_stops_before_dumping(run_backup):
    result, commands, backup_dir = run_backup(
        available={"pg": MINUTE_AVAILABLE - 1, "pg_data": ROOMY_AVAILABLE}
    )

    assert result.returncode != 0
    assert "insufficient disk in vnibb-db" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert _sets(backup_dir) == []


def test_streamed_postgres_does_not_need_another_dump_in_container(run_backup):
    """A 64 MiB temp reserve can stream a dump whose estimate exceeds /tmp."""
    backup_dir = run_backup.backup_dir
    _make_previous_set(backup_dir, PREV_STAMP, pg_bytes=REAL_SET_BYTES)
    result, commands, _ = run_backup(
        host_free_bytes=22 * GIB,
        available={"pg": MINUTE_AVAILABLE, "pg_data": MINUTE_AVAILABLE, "mongo": 22 * GIB, "mongo_data": 22 * GIB},
    )

    # A completed dump can legitimately shrink after retention; the producer
    # must reach pg_dump and accept its TOC rather than assume truncation.
    assert result.returncode == 0, result.stderr
    assert _calls(commands, "pg_dump")
    assert _calls(commands, "pg_restore")
    assert len(_sets(backup_dir)) == 2


@pytest.mark.parametrize("filesystem", ["pg", "pg_data", "mongo", "mongo_data"])
def test_unreadable_container_free_space_refuses_before_dump(run_backup, filesystem):
    result, commands, backup_dir = run_backup(available={filesystem: ""})

    assert result.returncode != 0
    assert "could not read free space" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == []

@pytest.mark.parametrize("df_format", ["busybox", "gnu"])
def test_portable_df_reports_kibibytes_as_bytes_for_each_filesystem(run_backup, df_format):
    available = {
        "pg": MINUTE_AVAILABLE,
        "pg_data": MINUTE_AVAILABLE + 1024,
        "mongo": 2 * GIB,
        "mongo_data": 3 * GIB,
    }
    result, commands, _ = run_backup(available=available, df_format=df_format)

    assert result.returncode == 0, result.stderr
    probes = _calls(commands, "df -Pk")
    assert len(probes) == 4
    assert any("vnibb-db df -Pk /var/lib/postgresql/data" in cmd for cmd in probes)
    assert any("vnibb-mongo df -Pk /data/db" in cmd for cmd in probes)
    assert f"tmp={MINUTE_AVAILABLE} data_free={MINUTE_AVAILABLE + 1024}" in result.stdout
    assert f"tmp={2 * GIB} bytes available" in result.stdout
    assert f"data={3 * GIB} bytes available" in result.stdout


@pytest.mark.parametrize("filesystem", ["pg", "pg_data", "mongo", "mongo_data"])
def test_failed_df_command_refuses_before_dump(run_backup, filesystem):
    result, commands, backup_dir = run_backup(df_fails=(filesystem,))

    assert result.returncode != 0
    assert "could not read free space" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == []


@pytest.mark.parametrize("output", ["", "nonsense", "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 100 1 oops 1% /tmp", "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 100 1 -1 1% /tmp"])
def test_malformed_df_output_refuses_before_dump(run_backup, output):
    result, commands, backup_dir = run_backup(available={"pg": output})

    assert result.returncode != 0
    assert "could not read free space" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == []


@pytest.mark.parametrize("container,diagnostic", [
    ("vnibb-db", "postgres container vnibb-db not running"),
    ("vnibb-mongo", "mongo container vnibb-mongo not running"),
])
def test_stopped_container_refuses_before_disk_probe_or_dump(run_backup, container, diagnostic):
    result, commands, backup_dir = run_backup(
        containers_running=tuple(name for name in ("vnibb-db", "vnibb-mongo") if name != container)
    )

    assert result.returncode != 0
    assert diagnostic in result.stderr
    assert not _calls(commands, "df -Pk")
    assert not _calls(commands, "pg_dump")
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == []


def test_missing_container_refuses_before_dump(run_backup):
    result, commands, backup_dir = run_backup(containers_present=("vnibb-db",))

    assert result.returncode != 0
    assert "mongo container vnibb-mongo not running" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert _sets(backup_dir) == []


def test_mongo_container_staging_space_exhaustion_stops_before_dumping(run_backup):
    result, commands, backup_dir = run_backup(
        available={"mongo": MINUTE_AVAILABLE, "mongo_data": MINUTE_AVAILABLE}
    )

    assert result.returncode != 0
    assert "insufficient disk in vnibb-mongo" in result.stderr
    assert not _calls(commands, "mongodump")
    assert _sets(backup_dir) == []


def test_postgres_data_filesystem_below_reserve_stops_the_run(run_backup):
    """The database's own filesystem must keep the safety reserve."""
    result, commands, backup_dir = run_backup(
        available={"pg_data": 1024},
    )

    assert result.returncode != 0
    assert "insufficient disk in vnibb-db" in result.stderr
    assert not _calls(commands, "pg_dump")
    assert _sets(backup_dir) == []


# --- streaming and integrity -------------------------------------------------


def test_postgres_is_streamed_with_no_container_temp_file(run_backup):
    result, commands, backup_dir = run_backup()
    assert result.returncode == 0, result.stderr

    pg_dump_calls = _calls(commands, "pg_dump")
    assert pg_dump_calls
    # No output path inside the container: the archive goes straight to stdout.
    assert all("/tmp/" not in call for call in pg_dump_calls), pg_dump_calls
    # The only docker cp is the mongo archive; no dump file is copied out.
    cp_targets = [call for call in _calls(commands, "cp") if ".dump" in call]
    assert cp_targets == [], cp_targets
    (stamp,) = _sets(backup_dir)
    dump = backup_dir / stamp / f"postgres-{stamp}.dump"
    assert dump.stat().st_size == 12 * 1024**2


def test_all_nul_postgres_stream_is_rejected(run_backup):
    """An out-of-space stream is all NULs, never a PGDMP header."""
    result, _, backup_dir = run_backup(pg_dump_bytes=_pg_dump_payload(12 * 1024**2, header=False))

    assert result.returncode != 0
    assert "begins with zero bytes" in result.stderr
    assert _sets(backup_dir) == []
    assert len(list(backup_dir.glob("*.FAILED"))) == 1




def test_tiny_postgres_dump_is_rejected(run_backup):
    result, _, backup_dir = run_backup(pg_dump_bytes=_pg_dump_payload(2048))

    assert result.returncode != 0
    assert "expected at least 10 MB" in result.stderr
    assert _sets(backup_dir) == []


def test_nonzero_pg_dump_exit_removes_the_partial_dump(run_backup):
    result, _, backup_dir = run_backup(pg_dump_fails=True)

    assert result.returncode != 0
    assert "pg_dump exited non-zero" in result.stderr
    assert _sets(backup_dir) == []


def test_mongo_archive_is_removed_from_the_container_after_copy(run_backup):
    result, commands, _ = run_backup()
    assert result.returncode == 0, result.stderr

    assert _calls(commands, "cp")
    assert any(
        cmd[:1] == ["exec"] and "rm" in cmd and any(".archive" in part for part in cmd)
        for cmd in commands
    ), commands


def test_short_mongo_copy_is_detected_against_the_container(run_backup):
    result, _, backup_dir = run_backup(staged_archive_short=True)

    assert result.returncode != 0
    assert "container archive is" in result.stderr
    assert _sets(backup_dir) == []


def test_mongodump_failure_marks_failed_removes_set_and_staging(run_backup):
    result, commands, backup_dir = run_backup(mongodump_fails=True)

    assert result.returncode != 0
    assert "mongodump exited non-zero" in result.stderr
    assert _sets(backup_dir) == []
    assert len(list(backup_dir.glob("*.FAILED"))) == 1
    assert any(
        cmd[:1] == ["exec"] and "rm" in cmd and any(".archive" in part for part in cmd)
        for cmd in commands
    ), commands


def test_failed_mongo_copy_cleans_the_staged_archive(run_backup):
    result, commands, backup_dir = run_backup(copy_fails=True)

    assert result.returncode != 0
    assert "docker cp of the mongo archive failed" in result.stderr
    assert _sets(backup_dir) == []
    assert any(
        cmd[:1] == ["exec"] and "rm" in cmd and any(".archive" in part for part in cmd)
        for cmd in commands
    ), commands


def test_staging_removal_failure_is_reported_with_the_path(run_backup):
    result, _, backup_dir = run_backup(staging_removal_fails=True)

    assert result.returncode != 0
    combined = result.stdout + result.stderr
    assert "CLEANUP FAILURE" in combined
    assert ".archive" in combined
    assert _sets(backup_dir) == []


def test_successful_run_writes_a_complete_paired_set(run_backup):
    result, _, backup_dir = run_backup()
    assert result.returncode == 0, result.stderr

    (stamp,) = _sets(backup_dir)
    set_dir = backup_dir / stamp
    manifest = json.loads((set_dir / "manifest.json").read_text())
    assert manifest["stamp"] == stamp
    assert manifest["postgres"]["database"] == "vnibb"
    assert manifest["mongo"]["included"] is True
    assert set(manifest["artifacts"]) == {
        f"postgres-{stamp}.dump",
        f"mongo-vnibb-market-{stamp}.archive.gz",
    }
    for name, record in manifest["artifacts"].items():
        payload = (set_dir / name).read_bytes()
        assert record["bytes"] == len(payload)
        assert record["sha256"] == hashlib.sha256(payload).hexdigest()
    assert {p.name for p in set_dir.iterdir()} == {*manifest["artifacts"], "manifest.json"}


def test_successful_run_keeps_the_previous_verified_set(run_backup):
    # A small prior size on purpose: a larger recorded size would legitimately
    # make this run reject its own dump as truncated (a different test).
    backup_dir = run_backup.backup_dir
    _make_previous_set(backup_dir, PREV_STAMP, pg_bytes=1024)

    result, _, _ = run_backup()

    assert result.returncode == 0, result.stderr
    assert PREV_STAMP in _sets(backup_dir)
    assert (backup_dir / PREV_STAMP / "manifest.json").is_file()
    # The previous set and the new one are separate directories.
    assert len(_sets(backup_dir)) == 2


# --- retention ---------------------------------------------------------------


def test_retention_prunes_only_after_a_verified_set(run_backup):
    # Three older sets exist before this run; the run adds a fourth and then
    # prunes back to the configured two.
    old = ("20250101T000000Z", "20250102T000000Z", "20250103T000000Z")
    backup_dir = run_backup.backup_dir
    for stamp in old:
        _make_previous_set(backup_dir, stamp, pg_bytes=1024)
    assert sorted(_sets(backup_dir)) == sorted(old)

    result, _, _ = run_backup(keep_sets=2)

    assert result.returncode == 0, result.stderr
    remaining = _sets(backup_dir)
    assert len(remaining) == 2
    assert "20250101T000000Z" not in remaining


def test_retention_failure_preserves_new_verified_pair(run_backup):
    backup_dir = run_backup.backup_dir
    for stamp in ("20250101T000000Z", "20250102T000000Z"):
        _make_previous_set(backup_dir, stamp, pg_bytes=1024)

    result, _, _ = run_backup(keep_sets=1, prune_fails=True)

    assert result.returncode != 0
    assert "RETENTION FAILURE" in result.stderr
    new_sets = set(_sets(backup_dir)) - {"20250101T000000Z", "20250102T000000Z"}
    assert len(new_sets) == 1
    new_set = backup_dir / new_sets.pop()
    manifest = json.loads((new_set / "manifest.json").read_text())
    assert set(manifest["artifacts"]) == {
        f"postgres-{new_set.name}.dump",
        f"mongo-vnibb-market-{new_set.name}.archive.gz",
    }
    for name, record in manifest["artifacts"].items():
        payload = (new_set / name).read_bytes()
        assert record["bytes"] == len(payload)
        assert record["sha256"] == hashlib.sha256(payload).hexdigest()
    assert (backup_dir / "20250102T000000Z").is_dir()
    assert not list(backup_dir.glob("*.FAILED"))


def test_failed_run_never_prunes_any_previous_set(run_backup):
    backup_dir = run_backup.backup_dir
    for stamp in ("20250101T000000Z", "20250102T000000Z"):
        _make_previous_set(backup_dir, stamp, pg_bytes=1024)
    before = set(_sets(backup_dir))

    result, _, _ = run_backup(keep_sets=1, host_free_bytes=MINUTE_AVAILABLE)

    assert result.returncode != 0
    assert before <= set(_sets(backup_dir))


def test_keep_sets_default_is_not_changed_by_this_script():
    assert 'KEEP_SETS="${KEEP_SETS:-7}"' in SCRIPT.read_text(encoding="utf-8")


# --- hygiene -----------------------------------------------------------------


def test_no_credentials_are_printed(run_backup):
    result, _, _ = run_backup()

    combined = result.stdout + result.stderr
    assert SECRET not in combined
    assert "MONGO_INITDB_ROOT_PASSWORD" not in combined
    assert "DATABASE_URL" not in combined
