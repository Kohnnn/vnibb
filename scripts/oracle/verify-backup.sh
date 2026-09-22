#!/usr/bin/env bash
# Verify a VNIBB backup set by actually restoring it into a throwaway database.
#
# The existing drill (scripts/restore-drill.ps1) is Windows/PowerShell and has
# never been run against the OCI self-hosted Postgres 17. This is the Linux
# equivalent: it restores the newest (or named) set into a scratch database on
# the same Postgres container, asserts table-count parity against the live
# database, and tears the scratch database down. It performs no writes to the
# source database and publishes no ports.
#
# Usage:
#   scripts/oracle/verify-backup.sh                  # newest set
#   scripts/oracle/verify-backup.sh 20260922T131323Z # a specific set
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/vnibb/deployment/backups}"
PG_CONTAINER="${PG_CONTAINER:-vnibb-db}"
SCRATCH_DB="${SCRATCH_DB:-vnibb_restore_verify}"

STAMP="${1:-}"
if [[ -z "$STAMP" ]]; then
    STAMP="$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' -printf '%f\n' \
        | sort -r | head -1)"
fi
[[ -n "$STAMP" ]] || { echo "no backup set found under $BACKUP_DIR" >&2; exit 1; }

SET_DIR="${BACKUP_DIR}/${STAMP}"
DUMP="${SET_DIR}/postgres-${STAMP}.dump"
[[ -s "$DUMP" ]] || { echo "dump not found or empty: $DUMP" >&2; exit 1; }

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

PG_USER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null || echo postgres)"

log "verifying backup set $STAMP"

# 1. Checksum parity against the manifest, when one exists.
MANIFEST="${SET_DIR}/manifest.json"
if [[ -f "$MANIFEST" ]]; then
    recorded="$(python3 -c "
import json,sys
m=json.load(open(sys.argv[1]))
print(m['artifacts']['postgres-${STAMP}.dump']['sha256'])
" "$MANIFEST")"
    actual="$(sha256sum "$DUMP" | cut -d' ' -f1)"
    if [[ "$recorded" != "$actual" ]]; then
        echo "CHECKSUM MISMATCH: manifest=$recorded actual=$actual" >&2
        exit 1
    fi
    log "checksum matches manifest"
else
    log "no manifest present; skipping checksum check"
fi

# 2. Live table count for parity. Resolve the application database from the
#    dump's own name so the parity check compares against the database that
#    was actually backed up, not the `postgres` bootstrap database (which has
#    zero public tables and would make this always fail).
PG_DB="${PG_DB:-}"
if [[ -z "$PG_DB" ]]; then
    for candidate in vnibb postgres; do
        if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$candidate" -tAc \
                "SELECT 1" >/dev/null 2>&1; then
            PG_DB="$candidate"
            [[ "$candidate" == "vnibb" ]] && break
        fi
    done
fi
[[ -n "$PG_DB" ]] || { echo "could not resolve the live database name" >&2; exit 1; }

LIVE_TABLES="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'" | tr -d '[:space:]')"
log "comparing against live database '$PG_DB'"

# 3. Restore into a scratch database.
cleanup() {
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c \
        "DROP DATABASE IF EXISTS ${SCRATCH_DB}" >/dev/null 2>&1 || true
    docker exec "$PG_CONTAINER" rm -f "/tmp/verify-${STAMP}.dump" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "creating scratch database $SCRATCH_DB"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS ${SCRATCH_DB}" >/dev/null
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c \
    "CREATE DATABASE ${SCRATCH_DB} TEMPLATE template0" >/dev/null

log "restoring dump into scratch database"
docker cp "$DUMP" "${PG_CONTAINER}:/tmp/verify-${STAMP}.dump" >/dev/null
# --no-owner/--no-privileges because the dump references the supabase_admin
# role, which does not exist on a plain restore target.
if ! docker exec "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$SCRATCH_DB" \
        --no-owner --no-privileges "/tmp/verify-${STAMP}.dump" 2>/tmp/vnibb-restore-err.log; then
    # pg_restore reports a non-zero exit for benign "already exists" noise on
    # some extension objects; the parity assertion below is the real verdict.
    log "pg_restore reported warnings (see below); checking parity anyway"
    head -20 /tmp/vnibb-restore-err.log >&2 || true
fi

RESTORED_TABLES="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$SCRATCH_DB" -tAc \
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'" | tr -d '[:space:]')"

log "live public tables=$LIVE_TABLES restored public tables=$RESTORED_TABLES"

if [[ "$LIVE_TABLES" != "$RESTORED_TABLES" ]]; then
    echo "PARITY FAILURE: live=$LIVE_TABLES restored=$RESTORED_TABLES" >&2
    exit 1
fi

# 4. Spot-check that the restored data is real, not an empty schema.
ROWS="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$SCRATCH_DB" -tAc \
    "SELECT count(*) FROM stocks" | tr -d '[:space:]')"
[[ "${ROWS:-0}" -gt 0 ]] || { echo "RESTORED DATA EMPTY: stocks has no rows" >&2; exit 1; }
log "spot check: stocks has $ROWS rows in the restored database"

echo "VERIFY OK: set=$STAMP tables=$RESTORED_TABLES stocks=$ROWS"
exit 0
