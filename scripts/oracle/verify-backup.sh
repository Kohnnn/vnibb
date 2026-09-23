#!/usr/bin/env bash
# Verify a VNIBB Postgres backup by restoring it into a new scratch database.
# Only this invocation's scratch database is dropped; the live database is read-only.
#
# Usage:
#   scripts/oracle/verify-backup.sh                  # newest set
#   scripts/oracle/verify-backup.sh 20260922T131323Z # a specific set
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/vnibb/deployment/backups}"
PG_CONTAINER="${PG_CONTAINER:-vnibb-db}"
SCRATCH_DB="${SCRATCH_DB:-vnibb_restore_verify_$(python3 -c 'import secrets; print(secrets.token_hex(8))')}"

[[ "$SCRATCH_DB" =~ ^[a-z_][a-z0-9_]*$ && ${#SCRATCH_DB} -le 63 ]] || {
    echo "invalid scratch database name: $SCRATCH_DB" >&2; exit 1;
}
STAMP="${1:-}"
if [[ -z "$STAMP" ]]; then
    STAMP="$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' -printf '%f\n' \
        | sort -r | head -1)"
fi
[[ -n "$STAMP" ]] || { echo "no backup set found under $BACKUP_DIR" >&2; exit 1; }
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "invalid backup stamp: $STAMP" >&2; exit 1; }

SET_DIR="${BACKUP_DIR}/${STAMP}"
DUMP="${SET_DIR}/postgres-${STAMP}.dump"
[[ -s "$DUMP" ]] || { echo "dump not found or empty: $DUMP" >&2; exit 1; }

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

PG_USER="${PG_USER:-$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || echo postgres)}"

log "verifying backup set $STAMP"

# A set without a valid manifest and intact artifacts is not verified.
MANIFEST="${SET_DIR}/manifest.json"
[[ -f "$MANIFEST" ]] || { echo "manifest missing: $MANIFEST" >&2; exit 1; }
expected_tables="$(python3 - "$MANIFEST" "$SET_DIR" "$STAMP" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

manifest_path, set_dir, stamp = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as source:
    manifest = json.load(source)
if manifest["stamp"] != stamp:
    raise ValueError("manifest stamp does not match backup set")
artifacts = manifest["artifacts"]
if f"postgres-{stamp}.dump" not in artifacts:
    raise ValueError("postgres dump is missing from manifest")
for name, record in artifacts.items():
    if Path(name).name != name:
        raise ValueError(f"invalid artifact name: {name}")
    artifact = Path(set_dir) / name
    digest = hashlib.sha256()
    with artifact.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if artifact.stat().st_size != record["bytes"] or digest.hexdigest() != record["sha256"]:
        raise ValueError(f"CHECKSUM OR SIZE MISMATCH: {name}")
tables = manifest["postgres"]["tables"]
if not isinstance(tables, int) or tables <= 0:
    raise ValueError("invalid postgres table count in manifest")
print(tables)
PY
)" || { echo "backup manifest/artifact verification failed" >&2; exit 1; }
log "artifact checksums and sizes match manifest"

# Never drop a pre-existing database, even when SCRATCH_DB was explicitly set.
# A random name avoids collisions between concurrent verification runs.
SCRATCH_CREATED=false
DUMP_ATTEMPTED=false
DUMP_IN_CONTAINER="/tmp/${SCRATCH_DB}.dump"

cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$SCRATCH_CREATED" == true ]]; then
        if ! docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres -c \
            "DROP DATABASE ${SCRATCH_DB}" >/dev/null; then
            echo "CLEANUP FAILURE: scratch database ${SCRATCH_DB} may remain" >&2
            status=1
        fi
    fi
    if [[ "$DUMP_ATTEMPTED" == true ]]; then
        if ! docker exec "$PG_CONTAINER" rm -f "$DUMP_IN_CONTAINER"; then
            echo "CLEANUP FAILURE: staged dump ${DUMP_IN_CONTAINER} may remain" >&2
            status=1
        fi
    fi
    if [[ "$status" -eq 0 && "$VERIFIED" == true ]]; then
        echo "VERIFY OK: set=$STAMP tables=$RESTORED_TABLES stocks=present stock_prices=present"
    fi
    exit "$status"
}
VERIFIED=false
trap cleanup EXIT

log "creating scratch database $SCRATCH_DB"
docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres -c \
    "CREATE DATABASE ${SCRATCH_DB} TEMPLATE template0" >/dev/null || {
    echo "scratch database already exists or could not be created: $SCRATCH_DB" >&2
    exit 1
}
SCRATCH_CREATED=true

if docker exec "$PG_CONTAINER" test -e "$DUMP_IN_CONTAINER" >/dev/null 2>&1; then
    echo "stale restore dump already exists: $DUMP_IN_CONTAINER" >&2
    exit 1
fi
log "restoring dump into scratch database"
DUMP_ATTEMPTED=true
docker cp "$DUMP" "${PG_CONTAINER}:${DUMP_IN_CONTAINER}" >/dev/null
# --no-owner/--no-privileges because the dump may reference roles absent on
# this restore target. Every other pg_restore error is a verification failure.
if docker exec "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$SCRATCH_DB" \
        --no-owner --no-privileges "$DUMP_IN_CONTAINER"; then
    :
else
    echo "RESTORE FAILURE: pg_restore exited non-zero" >&2
    exit 1
fi

# The producer records TABLE DATA entries, which need not equal the number of
# public schema tables (e.g. partitioned tables). Compare like with like.
RESTORED_TABLES="$(docker exec "$PG_CONTAINER" pg_restore --list "$DUMP_IN_CONTAINER" \
    | python3 -c 'import sys; print(sum(" TABLE DATA " in line for line in sys.stdin))')"
[[ "$RESTORED_TABLES" == "$expected_tables" ]] || {
    echo "TABLE DATA FAILURE: manifest=$expected_tables archive=$RESTORED_TABLES" >&2
    exit 1
}

# The archive must contain actual equity history, not only a stock list.
ROWS="$(docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$SCRATCH_DB" -tAc \
    "SELECT EXISTS (SELECT 1 FROM public.stocks)" | tr -d '[:space:]')"
[[ "$ROWS" == t ]] || { echo "RESTORED DATA EMPTY: stocks has no rows" >&2; exit 1; }
PRICES="$(docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$SCRATCH_DB" -tAc \
    "SELECT EXISTS (SELECT 1 FROM public.stock_prices)" | tr -d '[:space:]')"
[[ "$PRICES" == t ]] || { echo "RESTORED DATA EMPTY: stock_prices has no rows" >&2; exit 1; }

VERIFIED=true
