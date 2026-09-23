"""Exercise the restore verifier without connecting to a real Docker daemon."""

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "oracle" / "verify-backup.sh"
STAMP = "20260922T131323Z"


@pytest.fixture
def backup(tmp_path):
    backup_dir = tmp_path / "backups"
    set_dir = backup_dir / STAMP
    set_dir.mkdir(parents=True)
    dump = set_dir / f"postgres-{STAMP}.dump"
    mongo = set_dir / f"mongo-vnibb-market-{STAMP}.archive.gz"
    mongo.write_bytes(b"mongo archive bytes")
    dump.write_bytes(b"fixture archive bytes")
    (set_dir / "manifest.json").write_text(
        json.dumps(
            {
                "stamp": STAMP,
                "postgres": {"database": "vnibb", "tables": 2},
                "artifacts": {
                    dump.name: {
                        "bytes": dump.stat().st_size,
                        "sha256": hashlib.sha256(dump.read_bytes()).hexdigest(),
                    },
                    mongo.name: {
                        "bytes": mongo.stat().st_size,
                        "sha256": hashlib.sha256(mongo.read_bytes()).hexdigest(),
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(
        """#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

state_file = Path(os.environ['FAKE_DOCKER_STATE'])
state = json.loads(state_file.read_text())
args = sys.argv[1:]
state['commands'].append(args)
state_file.write_text(json.dumps(state))
if args[0] == 'cp':
    if state['copy_fails']:
        sys.exit(1)
    sys.exit(0)
assert args[0] == 'exec', args
command = args[2:]
if command[:2] == ['printenv', 'POSTGRES_USER']:
    print('postgres')
elif command[0] == 'test':
    if state['stale_dump_exists']:
        sys.exit(0)
    sys.exit(1)
elif command[0] == 'rm':
    if state['cleanup_dump_fails']:
        sys.exit(1)
elif command[0] == 'pg_restore':
    if '--list' in command:
        print('1; 0 0 TABLE DATA public stocks postgres')
        print('2; 0 0 TABLE DATA public stock_prices postgres')
    elif state['restore_fails']:
        print('partial restore: COPY failed', file=sys.stderr)
        sys.exit(1)
elif command[0] == 'psql':
    if '-c' in command:
        sql = command[command.index('-c') + 1]
        if sql.startswith('CREATE DATABASE') and state['database_exists']:
            print('database already exists', file=sys.stderr)
            sys.exit(1)
        if sql.startswith('DROP DATABASE') and state['cleanup_db_fails']:
            sys.exit(1)
    elif '-tAc' in command:
        sql = command[command.index('-tAc') + 1]
        if 'public.stocks' in sql:
            print('t')
        elif 'public.stock_prices' in sql:
            print('t' if state['prices_present'] else 'f')
        elif 'SELECT count(*) FROM stocks' in sql:
            print('1')
        elif sql == 'SELECT 1':
            print('1')
        else:
            raise AssertionError(sql)
    else:
        raise AssertionError(command)
else:
    raise AssertionError(command)
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)

    def verify(
        *,
        restore_fails=False,
        database_exists=False,
        prices_present=True,
        copy_fails=False,
        stale_dump_exists=False,
        cleanup_db_fails=False,
        cleanup_dump_fails=False,
    ):
        state_file = tmp_path / "docker-state.json"
        state_file.write_text(
            json.dumps(
                {
                    "commands": [],
                    "stale_dump_exists": stale_dump_exists,
                    "restore_fails": restore_fails,
                    "database_exists": database_exists,
                    "prices_present": prices_present,
                    "copy_fails": copy_fails,
                    "cleanup_db_fails": cleanup_db_fails,
                    "cleanup_dump_fails": cleanup_dump_fails,
                }
            ),
            encoding="utf-8",
        )
        env = os.environ.copy()
        env.update(
            BACKUP_DIR=str(backup_dir),
            SCRATCH_DB="vnibb_restore_verify_fixture",
            FAKE_DOCKER_STATE=str(state_file),
            PATH=f"{bin_dir}{os.pathsep}{env['PATH']}",
        )
        result = subprocess.run(
            ["bash", str(SCRIPT), STAMP], env=env, capture_output=True, text=True, check=False
        )
        return result, json.loads(state_file.read_text())["commands"]

    return verify, dump, set_dir


def test_successful_archive_verifies_and_drops_only_its_scratch_database(backup):
    verify, _, _ = backup
    result, commands = verify()

    assert result.returncode == 0, result.stderr
    assert "VERIFY OK" in result.stdout
    assert any("CREATE DATABASE vnibb_restore_verify_fixture" in part for cmd in commands for part in cmd)
    assert any("DROP DATABASE vnibb_restore_verify_fixture" in part for cmd in commands for part in cmd)

def test_failed_container_copy_removes_partial_dump(backup):
    verify, _, _ = backup
    result, commands = verify(copy_fails=True)

    assert result.returncode != 0
    assert "VERIFY OK" not in result.stdout
    assert any("rm" in cmd and "/tmp/vnibb_restore_verify_fixture.dump" in cmd for cmd in commands)
    assert "cp" not in result.stdout


@pytest.mark.parametrize("failed_step", ["cleanup_db_fails", "cleanup_dump_fails"])
def test_cleanup_failure_never_reports_verify_ok(backup, failed_step):
    verify, _, _ = backup
    result, commands = verify(**{failed_step: True})

    assert result.returncode != 0
    assert "VERIFY OK" not in result.stdout
    assert "CLEANUP FAILURE" in result.stderr
    assert any("DROP DATABASE" in part for cmd in commands for part in cmd)
    assert any("rm" in cmd for cmd in commands)


def test_stale_container_dump_refuses_and_removes_nothing(backup):
    verify, _, _ = backup
    result, commands = verify(stale_dump_exists=True)

    assert result.returncode != 0
    assert "stale restore dump already exists" in result.stderr
    assert "VERIFY OK" not in result.stdout
    assert not any("rm" in cmd for cmd in commands)


def test_partial_restore_fails_even_when_tables_and_stocks_would_match(backup):
    verify, _, _ = backup
    result, commands = verify(restore_fails=True)

    assert result.returncode != 0
    assert "VERIFY OK" not in result.stdout
    assert "RESTORE FAILURE" in result.stderr


def test_preexisting_scratch_database_is_never_dropped(backup):
    verify, _, _ = backup
    result, commands = verify(database_exists=True)

    assert result.returncode != 0
    assert "VERIFY OK" not in result.stdout
    assert not any("DROP DATABASE" in part for cmd in commands for part in cmd)


def test_missing_equity_history_fails_without_live_row_count_comparison(backup):
    verify, _, _ = backup
    result, commands = verify(prices_present=False)

    assert result.returncode != 0
    assert "stock_prices has no rows" in result.stderr
    assert "VERIFY OK" not in result.stdout
    assert not any("-d" in cmd and cmd[cmd.index("-d") + 1] == "vnibb" for cmd in commands if "-d" in cmd)


def test_corrupt_archive_fails_checksum_before_creating_database(backup):
    verify, dump, _ = backup
    dump.write_bytes(b"modified fixture archive")
    result, commands = verify()

    assert result.returncode != 0
    assert "CHECKSUM OR SIZE MISMATCH" in result.stderr
    assert "VERIFY OK" not in result.stdout
    assert not any("CREATE DATABASE" in part for cmd in commands for part in cmd)


def test_corrupt_mongo_artifact_fails_before_creating_database(backup):
    verify, _, set_dir = backup
    (set_dir / f"mongo-vnibb-market-{STAMP}.archive.gz").write_bytes(b"corrupt archive")
    result, commands = verify()

    assert result.returncode != 0
    assert "CHECKSUM OR SIZE MISMATCH" in result.stderr
    assert "VERIFY OK" not in result.stdout
    assert not any("CREATE DATABASE" in part for cmd in commands for part in cmd)
