#!/usr/bin/env bash
# Automated Postgres + Mongo backup for the VNIBB OCI node.
#
# Runs on the host (not in a container) because it needs both the docker
# socket and the ability to write outside any single service's lifetime.
# Install as /usr/local/sbin/vnibb-backup with a cron entry; see
# docs/BACKUP_RESTORE_DRILL.md for the restore procedure.
#
# Contract:
#   * one dated set per run, under $BACKUP_DIR
#   * every artifact gets a sha256 in the run's manifest
#   * a run that fails verification leaves a FAILED marker and exits non-zero
#     so cron mails the operator, and never prunes the previous good set
#   * retention keeps the newest $KEEP_SETS sets and prunes older ones only
#     after the new set has verified
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/srv/vnibb/docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-/srv/vnibb/deployment/env.oracle}"
BACKUP_DIR="${BACKUP_DIR:-/srv/vnibb/deployment/backups}"
KEEP_SETS="${KEEP_SETS:-7}"
PG_CONTAINER="${PG_CONTAINER:-vnibb-db}"
MONGO_CONTAINER="${MONGO_CONTAINER:-vnibb-mongo}"
MONGO_DB="${MONGO_DB:-vnibb-market}"
LOG_TAG="vnibb-backup"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
MANIFEST="${DEST}/manifest.json"
FAILED_MARKER="${BACKUP_DIR}/${STAMP}.FAILED"

fail() {
    log "FAILED: $*"
    printf '{"stamp":"%s","status":"failed","reason":"%s"}\n' "$STAMP" "$*" > "$FAILED_MARKER"
    exit 1
}

# --- preflight -------------------------------------------------------------
[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found: $COMPOSE_FILE"
docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || fail "postgres container $PG_CONTAINER not running"

mkdir -p "$DEST"
log "starting backup set $STAMP -> $DEST"

# The application database is taken from DATABASE_URL in the env file. The
# container's own POSTGRES_USER/POSTGRES_DB describe the *bootstrap* database
# (supabase_admin/postgres), which is not the app's -- reading them silently
# backed up the wrong 6-table database instead of the 17 GB vnibb one.
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-vnibb}"
if [[ -f "$ENV_FILE" ]]; then
    parsed="$(python3 - "$ENV_FILE" <<'PY'
import re, sys
url = ""
for line in open(sys.argv[1]):
    m = re.match(r'^DATABASE_URL\s*=\s*(\S+)', line.strip())
    if m:
        url = m.group(1)
        break
if url:
    m = re.match(r'^[^:]+://([^:]+):[^@]+@[^/]+/([^?]+)', url)
    if m:
        print(m.group(1))
        print(m.group(2))
PY
)"
    if [[ -n "$parsed" ]]; then
        PG_USER="$(printf '%s\n' "$parsed" | sed -n 1p)"
        PG_DB="$(printf '%s\n' "$parsed" | sed -n 2p)"
    fi
fi
if [[ -z "$PG_USER" || -z "$PG_DB" ]]; then
    fail "could not resolve the postgres user/database"
fi

# A bootstrap database means DATABASE_URL did not resolve. Failing here rather
# than dumping `postgres` keeps a silently-wrong backup from ever looking green.
if [[ "$PG_DB" == "postgres" ]]; then
    fail "refusing to back up the bootstrap database; DATABASE_URL did not resolve"
fi

log "dumping postgres (db=$PG_DB user=$PG_USER)"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc \
    -f "/tmp/${STAMP}.dump" || fail "pg_dump exited non-zero"
docker cp "${PG_CONTAINER}:/tmp/${STAMP}.dump" "${DEST}/postgres-${STAMP}.dump" \
    || fail "docker cp of the postgres dump failed"
docker exec "$PG_CONTAINER" rm -f "/tmp/${STAMP}.dump" || true

PG_DUMP="${DEST}/postgres-${STAMP}.dump"
[[ -s "$PG_DUMP" ]] || fail "postgres dump is empty"

# Size floor: a real dump of this database is hundreds of MB. This catches a
# wrong-database or schema-only dump that would otherwise verify fine.
PG_BYTES="$(stat -c %s "$PG_DUMP")"
if [[ "$PG_BYTES" -lt 10485760 ]]; then
    fail "postgres dump is only ${PG_BYTES} bytes; expected at least 10 MB"
fi
log "postgres dump size: $((PG_BYTES / 1048576)) MB"

# A dump is only evidence of a schema if pg_restore can read its TOC back.
PG_TABLES="$(docker exec -i "$PG_CONTAINER" pg_restore --list < "$PG_DUMP" \
    | grep -c 'TABLE DATA' || true)"
[[ "${PG_TABLES:-0}" -gt 0 ]] || fail "pg_restore could not read any TABLE DATA entries"
log "postgres dump verified: ${PG_TABLES} tables"

# Mongo is required: the microstructure corpus lives only here.
MONGO_USER="$(docker exec "$MONGO_CONTAINER" printenv MONGO_INITDB_ROOT_USERNAME 2>/dev/null || true)"
MONGO_PASS="$(docker exec "$MONGO_CONTAINER" printenv MONGO_INITDB_ROOT_PASSWORD 2>/dev/null || true)"
[[ -n "$MONGO_USER" && -n "$MONGO_PASS" ]] || fail "mongo root credentials not found in $MONGO_CONTAINER"

# `--archive` writes every database into one file inside the container, so it
# is only copied out after mongodump itself reports success. `--authenticationDatabase
# admin` is required: the app connects with authSource=admin, and without it
# mongodump exits 0 having dumped nothing.
log "dumping mongo (db=$MONGO_DB user=$MONGO_USER)"
docker exec "$MONGO_CONTAINER" mongodump \
    --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin \
    --archive="/tmp/${STAMP}.archive" --gzip \
    || fail "mongodump exited non-zero"

docker cp "${MONGO_CONTAINER}:/tmp/${STAMP}.archive" \
    "${DEST}/mongo-${MONGO_DB}-${STAMP}.archive.gz" \
    || fail "docker cp of the mongo archive failed"
docker exec "$MONGO_CONTAINER" rm -f "/tmp/${STAMP}.archive" || true

MONGO_ARCHIVE="${DEST}/mongo-${MONGO_DB}-${STAMP}.archive.gz"
MONGO_BYTES="$(stat -c %s "$MONGO_ARCHIVE")"
if [[ "$MONGO_BYTES" -lt 1024 ]]; then
    fail "mongo archive is only ${MONGO_BYTES} bytes; the dump captured nothing"
fi
MONGO_OK=true
log "mongo dump verified: $((MONGO_BYTES / 1048576)) MB"

# --- manifest --------------------------------------------------------------
{
    printf '{\n  "stamp": "%s",\n  "created_at_utc": "%s",\n' "$STAMP" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "postgres": {"database": "%s", "tables": %s},\n' "$PG_DB" "$PG_TABLES"
    printf '  "mongo": {"database": "%s", "included": %s},\n' "$MONGO_DB" "$MONGO_OK"
    printf '  "artifacts": {\n'
    first=true
    for f in "${DEST}"/*; do
        [[ -f "$f" ]] || continue
        base="$(basename "$f")"
        size="$(stat -c %s "$f")"
        sha="$(sha256sum "$f" | cut -d' ' -f1)"
        $first || printf ',\n'
        printf '    "%s": {"bytes": %s, "sha256": "%s"}' "$base" "$size" "$sha"
        first=false
    done
    printf '\n  }\n}\n'
} > "$MANIFEST"

# Re-read the manifest to be sure it is valid JSON before trusting the set.
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MANIFEST" \
    || fail "manifest is not valid JSON"
log "manifest written: $MANIFEST"

# --- retention -------------------------------------------------------------
# Only prune after this set verified. The FAILED marker from an earlier run is
# never counted as a set.
mapfile -t SETS < <(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' \
    -printf '%f\n' | sort -r)
if [[ "${#SETS[@]}" -gt "$KEEP_SETS" ]]; then
    for old in "${SETS[@]:$KEEP_SETS}"; do
        log "pruning old set $old"
        rm -rf "${BACKUP_DIR:?}/${old}"
    done
fi

log "backup set $STAMP complete: ${#SETS[@]} set(s) retained"
exit 0
