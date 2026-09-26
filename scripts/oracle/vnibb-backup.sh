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
#   * a disk preflight runs BEFORE anything is written; a run that cannot
#     fit the set on the host and in the containers' write layer exits
#     without creating a set directory, without a dump and without any
#     database write
#   * the Postgres dump and the Mongo archive are written once: Postgres is
#     streamed straight to its destination file, and the Mongo archive is
#     staged in its container and copied out once, then removed
#   * every artifact gets a sha256 in the run's manifest
#   * a run that fails verification leaves a FAILED marker and exits non-zero
#     so cron mails the operator, and never prunes the previous good set
#   * a failed run removes only the incomplete set directory it created; a
#     previous good set is never a removal candidate
#   * retention keeps the newest $KEEP_SETS sets and prunes older ones only
#     after the new set has verified; $KEEP_SETS is never adjusted silently
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/srv/vnibb/docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-/srv/vnibb/deployment/env.oracle}"
BACKUP_DIR="${BACKUP_DIR:-/srv/vnibb/deployment/backups}"
KEEP_SETS="${KEEP_SETS:-7}"
PG_CONTAINER="${PG_CONTAINER:-vnibb-db}"
MONGO_CONTAINER="${MONGO_CONTAINER:-vnibb-mongo}"
MONGO_DB="${MONGO_DB:-vnibb-market}"

# --- disk preflight settings ------------------------------------------------
# Free space that must remain after the run, on the host filesystem holding
# $BACKUP_DIR. 5 GiB keeps the node away from 100% full, where Postgres and
# mongod both misbehave.
HOST_SAFETY_RESERVE_BYTES="${HOST_SAFETY_RESERVE_BYTES:-5368709120}"
# Free space that must remain after the run in the containers' own writable
# layer. Both engines write WAL/journal/oplog/appends while dumping; below
# ~64 MiB Docker may also refuse to start a container at all.
CONTAINER_SAFETY_RESERVE_BYTES="${CONTAINER_SAFETY_RESERVE_BYTES:-67108864}"
# Same-host stream/filter headroom held in memory and in the pipe, not on disk.
STREAM_BUFFER_BYTES="${STREAM_BUFFER_BYTES:-1048576}"
# How much larger this run's dump may be than the last successful one before
# the preflight refuses. The estimate tracks the *compressed dump* the backup
# actually produces, never the uncompressed data directory: this database's
# data directory is ~124 GiB while its dump is ~9.9 GiB, so sizing off the data
# directory would demand ~136 GiB and make backups impossible on a 25 GiB node.
# 1.5x absorbs normal ingest growth (a 15-minute pipeline adding rows) while
# still refusing a host that cannot hold the set.
PG_GROWTH_MARGIN_PCT="${PG_GROWTH_MARGIN_PCT:-150}"
# Same idea for mongodump --archive --gzip.
MONGO_GROWTH_MARGIN_PCT="${MONGO_GROWTH_MARGIN_PCT:-200}"
# Floor used when no usable previous paired set is available; never infer
# additional headroom from the uncompressed database directory.
PG_MIN_EXPECTED_BYTES="${PG_MIN_EXPECTED_BYTES:-17179869184}"
MONGO_MIN_EXPECTED_BYTES="${MONGO_MIN_EXPECTED_BYTES:-268435456}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# Failures go to stderr as well, matching verify-backup.sh, so cron mail and
# `2>` redirection see the reason without parsing the normal progress log.
warn() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
MANIFEST="${DEST}/manifest.json"
FAILED_MARKER="${BACKUP_DIR}/${STAMP}.FAILED"
# The Mongo archive has to be a finished file before it can be copied out, so
# it is staged in the mongo container's temp directory (Postgres only needed
# that because it used to write a file too). The staging cost is covered by
# the preflight and the file is removed as soon as the copy out returns.
MONGO_ARCHIVE_IN_CONTAINER="/tmp/${STAMP}.archive"
DEST_CREATED=false
DEST_REMOVED=false
MONGO_COPY_ATTEMPTED=false
MONGO_STAGED_CLEAN=false

# --- failure handling -------------------------------------------------------
# Removes only what this run created. A previous good set is a different
# directory, so it is never a removal candidate.
remove_incomplete_set() {
    [[ "$DEST_CREATED" == true && "$DEST_REMOVED" == false ]] || return 0
    # Marked first: the trap may run next, and it must not remove twice or log a
    # second time for the same directory.
    DEST_REMOVED=true
    rm -rf "${BACKUP_DIR:?}/${STAMP}"
    if [[ -e "$DEST" ]]; then
        warn "CLEANUP WARNING: incomplete set $DEST may remain"
    else
        log "removed incomplete set $DEST"
    fi
}

# Fail-closed: staged files outside the set directory are removed, and a
# removal that fails is reported with the exact path rather than swallowed.
remove_container_staging() {
    [[ "$MONGO_COPY_ATTEMPTED" == true && "$MONGO_STAGED_CLEAN" == false ]] || return 0
    if docker exec "$MONGO_CONTAINER" rm -f "$MONGO_ARCHIVE_IN_CONTAINER" >/dev/null 2>&1; then
        MONGO_STAGED_CLEAN=true
    else
        warn "CLEANUP FAILURE: staged mongo archive $MONGO_ARCHIVE_IN_CONTAINER may remain in $MONGO_CONTAINER"
    fi
}

# Every failure goes through here, so a FAILED marker, a removed incomplete set
# and a freed container staging file are one code path, not three that can drift
# apart. The marker is written last: it is the durable evidence of the failure.
fail() {
    warn "FAILED: $*"
    remove_container_staging || true
    remove_incomplete_set || true
    printf '{"stamp":"%s","status":"failed","reason":"%s"}\n' "$STAMP" "$*" > "$FAILED_MARKER"
    exit 1
}

# An uncaught non-zero exit (a bug, or a failure between mkdir and the first
# fail) still must not leave an empty set directory behind.
trap_cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$status" -ne 0 ]]; then
        remove_container_staging
        remove_incomplete_set
    fi
    exit "$status"
}

stat_bytes() { stat -c %s "$1"; }

# $HOST_FREE_BYTES_OVERRIDE lets a drill exercise the preflight against a value
# other than the real one. It is an operator/test knob, not a default: leaving
# it unset always reads the true free space.
filesystem_avail_bytes() {
    if [[ -n "${HOST_FREE_BYTES_OVERRIDE:-}" ]]; then
        printf '%s\n' "$HOST_FREE_BYTES_OVERRIDE"
        return 0
    fi
    df -B1 --output=avail "$1" 2>/dev/null | tail -n 1 | tr -d '[:space:]'
}

# df -Pk is supported by both GNU coreutils and BusyBox; parse the POSIX
# 1-KiB-block table on the host instead of requiring Python in the image.
container_avail_bytes() {
    local listing
    listing="$(docker exec "$1" df -Pk "$2" 2>/dev/null)" || return 1
    python3 -c '
import sys

rows = sys.stdin.read().splitlines()
if len(rows) != 2 or rows[0].split()[:4] not in (["Filesystem", "1024-blocks", "Used", "Available"], ["Filesystem", "1K-blocks", "Used", "Available"]):
    sys.exit(1)
fields = rows[1].split()
if len(fields) < 6 or not all(value.isascii() and value.isdecimal() for value in fields[1:4]):
    sys.exit(1)
print(int(fields[3]) * 1024)
' <<< "$listing"
}

# --- preflight -------------------------------------------------------------
[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found: $COMPOSE_FILE"
[[ "$(docker inspect --format '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null)" == true ]] || fail "postgres container $PG_CONTAINER not running"
[[ "$(docker inspect --format '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null)" == true ]] || fail "mongo container $MONGO_CONTAINER not running"

mkdir -p "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" ]] || fail "backup directory could not be created: $BACKUP_DIR"
[[ ! -e "$DEST" ]] || fail "backup set $STAMP already exists"
[[ ! -e "$FAILED_MARKER" ]] || fail "a previous run for $STAMP already failed; not overwriting its marker"

# Docker can place the writable layer, PostgreSQL data and Mongo data on
# different filesystems. Read free space inside each container; an unreadable
# answer must prevent a dump rather than silently skip the check.
PG_DATA_SOURCE="/var/lib/postgresql/data"
MONGO_DATA_SOURCE="/data/db"
PG_TMP_SOURCE="/tmp"
MONGO_TMP_SOURCE="/tmp"
PG_DATA_DIR="$(docker exec "$PG_CONTAINER" sh -c 'echo ${POSTGRES_DATA_DIR:-}' 2>/dev/null || true)"
if [[ -n "$PG_DATA_DIR" ]]; then
    PG_DATA_SOURCE="$PG_DATA_DIR"
fi
PG_TMP_SOURCE="$(docker exec "$PG_CONTAINER" sh -c 'echo ${TMPDIR:-/tmp}' 2>/dev/null || echo /tmp)"
MONGO_TMP_SOURCE="$(docker exec "$MONGO_CONTAINER" sh -c 'echo ${TMPDIR:-/tmp}' 2>/dev/null || echo /tmp)"
PG_TMP_REF="$(container_avail_bytes "$PG_CONTAINER" "$PG_TMP_SOURCE" || true)"
MONGO_DATA_REF="$(container_avail_bytes "$MONGO_CONTAINER" "$MONGO_DATA_SOURCE" || true)"
MONGO_TMP_REF="$(container_avail_bytes "$MONGO_CONTAINER" "$MONGO_TMP_SOURCE" || true)"

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

# --- disk preflight ---------------------------------------------------------
# Everything this run will need, in bytes, before a single byte is written.
# Sizing is driven by the last *successful* paired set's recorded artifact
# sizes (the compressed dump and archive the backup actually produced), not by
# the uncompressed data directories. A set whose manifest is missing,
# unparsable or lacks a Postgres artifact is ignored and the floor applies --
# a damaged previous set never lowers the requirement.
PREV_SET=""
PREV_PG_BYTES=""
PREV_MONGO_BYTES=""
while IFS= read -r candidate; do
    [[ "$candidate" == "$STAMP" ]] && continue
    [[ -f "${BACKUP_DIR}/${candidate}/manifest.json" ]] || continue
    PREV_SET="$candidate"
    break
done < <(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' -printf '%f\n' | sort -r)

if [[ -n "$PREV_SET" ]]; then
    # Prints "<postgres bytes> <mongo bytes>", either possibly empty.
    parsed_sizes="$(python3 - "${BACKUP_DIR}/${PREV_SET}/manifest.json" "$PREV_SET" "$PG_DB" "$MONGO_DB" <<'PY'
import json
import sys

manifest_path, stamp, database, mongo_database = sys.argv[1:]


def artifact_bytes(manifest, name):
    record = (manifest.get("artifacts") or {}).get(name) or {}
    size = record.get("bytes")
    return int(size) if isinstance(size, int) and size > 0 else None


try:
    with open(manifest_path, encoding="utf-8") as source:
        manifest = json.load(source)
except (OSError, ValueError):
    manifest = None

postgres_bytes = None
mongo_bytes = None
if manifest and manifest.get("stamp") == stamp:
    postgres = manifest.get("postgres") or {}
    mongo = manifest.get("mongo") or {}
    if postgres.get("database") == database:
        postgres_bytes = artifact_bytes(manifest, f"postgres-{stamp}.dump")
    if mongo.get("database") == mongo_database and mongo.get("included") is True:
        mongo_bytes = artifact_bytes(manifest, f"mongo-{mongo_database}-{stamp}.archive.gz")

print(postgres_bytes if postgres_bytes else "")
print(mongo_bytes if mongo_bytes else "")
PY
)"
    PREV_PG_BYTES="$(printf '%s\n' "$parsed_sizes" | sed -n 1p)"
    PREV_MONGO_BYTES="$(printf '%s\n' "$parsed_sizes" | sed -n 2p)"
fi


if [[ -n "$PREV_PG_BYTES" ]]; then
    # Learn from the compressed dump this backup actually produced last time,
    # grown by the configured margin. The data directory is deliberately NOT
    # used as a basis: it stores uncompressed pages and exceeds the dump by an
    # order of magnitude here, which would peg the demand far above any real
    # host headroom.
    PG_EXPECTED_BYTES=$(( PREV_PG_BYTES * PG_GROWTH_MARGIN_PCT / 100 ))
    PG_BASIS="last successful set ${PREV_SET} dump ${PREV_PG_BYTES} B x${PG_GROWTH_MARGIN_PCT}%"
else
    PG_EXPECTED_BYTES="$PG_MIN_EXPECTED_BYTES"
    PG_BASIS="floor (no usable previous set manifest)"
fi

# Mongo: same approach, from the last successful set's archive.
MONGO_BASIS=""
if [[ -n "$PREV_MONGO_BYTES" ]]; then
    MONGO_EXPECTED_BYTES=$(( PREV_MONGO_BYTES * MONGO_GROWTH_MARGIN_PCT / 100 ))
    MONGO_BASIS="last successful set ${PREV_SET} archive ${PREV_MONGO_BYTES} B x${MONGO_GROWTH_MARGIN_PCT}%"
else
    MONGO_EXPECTED_BYTES="$MONGO_MIN_EXPECTED_BYTES"
    MONGO_BASIS="floor (no usable previous set manifest)"
fi

# Mongo occupies container staging and host destination simultaneously until
# the copied archive is verified; on OCI both paths may share the root disk.
HOST_NEED=$(( PG_EXPECTED_BYTES + 2 * MONGO_EXPECTED_BYTES + STREAM_BUFFER_BYTES + HOST_SAFETY_RESERVE_BYTES ))
# pg_dump streams to the host. Container /tmp needs only its configured
# temporary/WAL reserve, never a second dump-sized allocation.
PG_NEED="$CONTAINER_SAFETY_RESERVE_BYTES"
# mongodump writes the whole archive before anything is copied out, and the
# archive is not streamable, so one archive-sized file must fit in the
# container filesystem that holds its output path.
MONGO_NEED=$(( MONGO_EXPECTED_BYTES + CONTAINER_SAFETY_RESERVE_BYTES ))

HOST_AVAIL="$(filesystem_avail_bytes "$BACKUP_DIR")"
[[ -n "$HOST_AVAIL" && "$HOST_AVAIL" -gt 0 ]] || fail "could not read free space for $BACKUP_DIR"

log "disk preflight: postgres estimate $(( PG_EXPECTED_BYTES / 1048576 )) MB (${PG_BASIS})"
log "disk preflight: mongo estimate $(( MONGO_EXPECTED_BYTES / 1048576 )) MB (${MONGO_BASIS})"
log "disk preflight: host $BACKUP_DIR needs $(( HOST_NEED / 1048576 )) MB of $(( HOST_AVAIL / 1048576 )) MB free"
if [[ "$HOST_AVAIL" -lt "$HOST_NEED" ]]; then
    fail "insufficient host disk for backup set: need ${HOST_NEED} bytes of ${HOST_AVAIL} free under $BACKUP_DIR (postgres estimate ${PG_EXPECTED_BYTES}, staged and copied mongo ${MONGO_EXPECTED_BYTES} each)"
fi

# pg_dump streams to the host, but the server still needs room for WAL, temp
# files and logs. A missing or malformed df answer cannot be treated as free
# space; check each relevant container filesystem before starting either dump.
[[ "$PG_TMP_REF" =~ ^[0-9]+$ ]] || fail "could not read free space in $PG_CONTAINER $PG_TMP_SOURCE"
if (( PG_TMP_REF < PG_NEED )); then
    fail "insufficient disk in $PG_CONTAINER $PG_TMP_SOURCE: needs ${PG_NEED} bytes, ${PG_TMP_REF} available"
fi
PG_DATA_FREE="$(container_avail_bytes "$PG_CONTAINER" "$PG_DATA_SOURCE" || true)"
[[ "$PG_DATA_FREE" =~ ^[0-9]+$ ]] || fail "could not read free space in $PG_CONTAINER $PG_DATA_SOURCE"
if (( PG_DATA_FREE < CONTAINER_SAFETY_RESERVE_BYTES )); then
    fail "insufficient disk in $PG_CONTAINER $PG_DATA_SOURCE: ${PG_DATA_FREE} bytes free, reserve is ${CONTAINER_SAFETY_RESERVE_BYTES}"
fi
log "disk preflight: $PG_CONTAINER tmp=${PG_TMP_REF} data_free=${PG_DATA_FREE} (reserve ${PG_NEED})"

# Mongo needs room for the staged archive. Both paths are checked independently
# because they may be on different filesystems.
for ref in "tmp:$MONGO_TMP_REF:$MONGO_TMP_SOURCE" "data:$MONGO_DATA_REF:$MONGO_DATA_SOURCE"; do
    IFS=: read -r label avail source <<< "$ref"
    [[ "$avail" =~ ^[0-9]+$ ]] || fail "could not read free space in $MONGO_CONTAINER $source"
    if (( avail < MONGO_NEED )); then
        fail "insufficient disk in $MONGO_CONTAINER $source for the staged mongo archive: needs ${MONGO_NEED} bytes, ${avail} available"
    fi
    log "disk preflight: $MONGO_CONTAINER ${label}=${avail} bytes available (needs ${MONGO_NEED})"
done

log "disk preflight passed"

# Only now is a set created, and only now is anything written to disk.
mkdir "$DEST" || fail "could not create backup set directory $DEST"
DEST_CREATED=true
trap trap_cleanup EXIT
log "starting backup set $STAMP -> $DEST"

# --- postgres ---------------------------------------------------------------
# Streamed: pg_dump writes the custom-format archive to stdout and the host
# redirects it to its final path, so the dump exists once instead of inside the
# container and on the host. The first 1 KiB must contain something other than
# NUL bytes -- an out-of-space or truncated stream is all NULs, never a PGDMP
# header -- and pg_restore's TOC is read back from the same file afterwards.
PG_DUMP="${DEST}/postgres-${STAMP}.dump"
log "dumping postgres (db=$PG_DB user=$PG_USER, streamed to ${PG_DUMP})"
if ! docker exec -i "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$PG_DUMP"; then
    fail "pg_dump exited non-zero"
fi

PG_BYTES="$(stat_bytes "$PG_DUMP")"
[[ -s "$PG_DUMP" ]] || fail "postgres dump is empty"
# An out-of-space or truncated stream starts with NUL bytes, never with the
# PGDMP header; this is a cheap first look before the TOC read below.
PG_HEAD_NONZERO="$(head -c 1024 "$PG_DUMP" | grep -c . || true)"
[[ "${PG_HEAD_NONZERO:-0}" -gt 0 ]] || fail "postgres dump begins with zero bytes; the stream was short or the disk filled"

# Size floor: a real dump of this database is hundreds of MB. This catches a
# wrong-database or schema-only dump that would otherwise verify fine.
if [[ "$PG_BYTES" -lt 10485760 ]]; then
    fail "postgres dump is only ${PG_BYTES} bytes; expected at least 10 MB"
fi
log "postgres dump size: $((PG_BYTES / 1048576)) MB"

# Read the streamed archive's TOC through the PostgreSQL container over stdin;
# the OCI host has no pg_restore, and no second dump is staged in the container.
if ! PG_TOC="$(docker exec -i "$PG_CONTAINER" pg_restore --list < "$PG_DUMP")"; then
    fail "pg_restore could not read the postgres dump TOC"
fi
PG_TABLES="$(printf '%s\n' "$PG_TOC" | grep -c 'TABLE DATA' || true)"
[[ "${PG_TABLES:-0}" -gt 0 ]] || fail "pg_restore could not read any TABLE DATA entries"
log "postgres dump verified: ${PG_TABLES} tables"

# --- mongo ------------------------------------------------------------------
# Mongo is required: the microstructure corpus lives only here.
MONGO_USER="$(docker exec "$MONGO_CONTAINER" printenv MONGO_INITDB_ROOT_USERNAME 2>/dev/null || true)"
MONGO_PASS="$(docker exec "$MONGO_CONTAINER" printenv MONGO_INITDB_ROOT_PASSWORD 2>/dev/null || true)"
[[ -n "$MONGO_USER" && -n "$MONGO_PASS" ]] || fail "mongo root credentials not found in $MONGO_CONTAINER"

# `--archive` writes every database into one file, so it is only copied out
# after mongodump itself reports success. It cannot be streamed: `docker cp`
# needs a finished file, and a copy that fails half way would otherwise look
# like a complete archive. The archive size is preflighted above.
# `--authenticationDatabase admin` is required: the app connects with
# authSource=admin, and without it mongodump exits 0 having dumped nothing.
log "dumping mongo (db=$MONGO_DB user=$MONGO_USER)"
# Staged output exists from here on, so a later failure must clear it.
MONGO_COPY_ATTEMPTED=true
if ! docker exec "$MONGO_CONTAINER" mongodump \
    --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin \
    --archive="$MONGO_ARCHIVE_IN_CONTAINER" --gzip; then
    fail "mongodump exited non-zero"
fi

MONGO_ARCHIVE="${DEST}/mongo-${MONGO_DB}-${STAMP}.archive.gz"
if ! docker cp "${MONGO_CONTAINER}:${MONGO_ARCHIVE_IN_CONTAINER}" "$MONGO_ARCHIVE"; then
    fail "docker cp of the mongo archive failed"
fi

# Verify the copy while the staged original still exists: a `docker cp` that
# stopped early is a short file, not a smaller dump, and that can only be told
# apart by comparing against the container's own copy.
MONGO_BYTES="$(stat_bytes "$MONGO_ARCHIVE")"
if [[ "$MONGO_BYTES" -lt 1024 ]]; then
    fail "mongo archive is only ${MONGO_BYTES} bytes; the dump captured nothing"
fi
# gzip magic: a copy that landed as zeroes is not a dump.
MONGO_MAGIC="$(head -c 2 "$MONGO_ARCHIVE" | od -An -tx1 | tr -d '[:space:]')"
[[ "$MONGO_MAGIC" == "1f8b" ]] || fail "mongo archive is not gzip data (magic ${MONGO_MAGIC:-none})"
MONGO_STAGED_BYTES="$(docker exec "$MONGO_CONTAINER" stat -c %s "$MONGO_ARCHIVE_IN_CONTAINER" 2>/dev/null || true)"
if [[ -z "$MONGO_STAGED_BYTES" ]]; then
    fail "staged mongo archive $MONGO_ARCHIVE_IN_CONTAINER is missing from $MONGO_CONTAINER; the copy cannot be trusted"
fi
if [[ "$MONGO_STAGED_BYTES" -ne "$MONGO_BYTES" ]]; then
    fail "mongo archive copy is ${MONGO_BYTES} bytes but the container archive is ${MONGO_STAGED_BYTES}"
fi

# The copy is verified and the staging file is no longer needed.
remove_container_staging
[[ "$MONGO_STAGED_CLEAN" == true ]] || fail "staged mongo archive could not be removed from $MONGO_CONTAINER"
MONGO_OK=true
log "mongo dump verified: $((MONGO_BYTES / 1048576)) MB"

# --- manifest --------------------------------------------------------------
{
    printf '{\n  "stamp": "%s",\n  "created_at_utc": "%s",\n' "$STAMP" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "postgres": {"database": "%s", "tables": %s},\n' "$PG_DB" "$PG_TABLES"
    printf '  "mongo": {"database": "%s", "included": %s},\n' "$MONGO_DB" "$MONGO_OK"
    printf '  "artifacts": {\n'
    first=true
    # The manifest describes only the two payloads. Never hash the manifest
    # while it is still being written or include it as its own artifact.
    for f in "$PG_DUMP" "$MONGO_ARCHIVE"; do
        base="$(basename "$f")"
        size="$(stat_bytes "$f")"
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

# Reviewers look for two files inside the set: the dump and the mongo archive.
# Anything else that reached $DEST is a staging leftover, and a set that ships
# one is not the set its manifest describes.
for f in "${DEST}"/*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    case "$base" in
        "manifest.json"|"postgres-${STAMP}.dump"|"mongo-${MONGO_DB}-${STAMP}.archive.gz") ;;
        *) fail "unexpected file in backup set: $base" ;;
    esac
done

# From here the paired set is complete. A later retention failure must never
# trigger the incomplete-set trap and delete this verified replacement.
DEST_CREATED=false
trap - EXIT

# --- retention -------------------------------------------------------------
# Only prune after this set verified. The FAILED marker from an earlier run is
# never counted as a set. $KEEP_SETS is whatever the operator configured; this
# script never adjusts it, so retention stays documented behaviour.
mapfile -t SETS < <(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' \
    -printf '%f\n' | sort -r)
if [[ "${#SETS[@]}" -gt "$KEEP_SETS" ]]; then
    for old in "${SETS[@]:$KEEP_SETS}"; do
        # The set just written is always newest and therefore always inside the
        # kept prefix, but never let a misconfigured KEEP_SETS delete it: that
        # would turn a successful backup into data loss.
        [[ "$old" == "$STAMP" ]] && continue
        log "pruning old set $old"
        if ! rm -rf "${BACKUP_DIR:?}/${old}"; then
            warn "RETENTION FAILURE: could not remove $old; verified new set $STAMP remains available"
            exit 1
        fi
    done
fi

log "backup set $STAMP complete: ${#SETS[@]} set(s) retained, keeping $KEEP_SETS"
exit 0
