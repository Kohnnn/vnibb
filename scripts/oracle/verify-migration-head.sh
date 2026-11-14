#!/usr/bin/env bash
# Refuse a migration that the approved head does not cover, BEFORE it is applied.
#
# `alembic upgrade head` moves the database to whatever head the candidate image
# ships. Checking `alembic current` afterwards cannot stop an unreviewed migration
# from already having run. This guard compares the candidate image's own script
# head against the independently approved head first, so a candidate that bumps
# the head is rejected while the database is still untouched.
#
# Usage (read-only; no database write, no container left behind):
#   APPROVED_ALEMBIC_HEAD=<rev> COMPOSE_FILE=... bash scripts/oracle/verify-migration-head.sh
set -euo pipefail

: "${APPROVED_ALEMBIC_HEAD:?Set APPROVED_ALEMBIC_HEAD to the independently reviewed revision}"
# The approved revision must be a single real head, not a range or a wildcard.
if ! printf '%s' "$APPROVED_ALEMBIC_HEAD" | grep -Eq '^[A-Za-z0-9_]+$'; then
  echo "verify-migration-head: APPROVED_ALEMBIC_HEAD is not a single revision id" >&2
  exit 2
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-deployment/env.oracle}"
DOCKER_BIN="${DOCKER_BIN:-docker}"

compose() {
  "$DOCKER_BIN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# `alembic heads` reads the image's migration scripts only; it needs no database.
candidate_heads="$(compose run --rm --no-deps --entrypoint alembic migrate \
  -c /app/alembic.ini heads 2>/dev/null \
  | sed -n 's/^\([A-Za-z0-9_]*\) (head)$/\1/p' | sort -u)"

if [ -z "$candidate_heads" ]; then
  echo "verify-migration-head: could not read the candidate image's migration heads" >&2
  exit 1
fi

if [ "$(printf '%s\n' "$candidate_heads" | wc -l)" -ne 1 ]; then
  echo "verify-migration-head: candidate has multiple heads, refusing an unreviewed merge:" >&2
  printf '  %s\n' $candidate_heads >&2
  exit 1
fi

if [ "$candidate_heads" != "$APPROVED_ALEMBIC_HEAD" ]; then
  echo "verify-migration-head: candidate image head '$candidate_heads' is not the approved head '$APPROVED_ALEMBIC_HEAD'" >&2
  echo "Refusing: applying it would run an unreviewed migration before any check could see it." >&2
  exit 1
fi

current="$(compose run --rm --no-deps --entrypoint alembic migrate \
  -c /app/alembic.ini current 2>/dev/null \
  | sed -n 's/^\([A-Za-z0-9_]*\) (head)$/\1/p' | sort -u)"

# A fresh database reports nothing applied; upgrade to the approved head is safe.
if [ -z "$current" ]; then
  echo "verify-migration-head: candidate head '$candidate_heads' matches the approved head; database has no applied revision"
  exit 0
fi

if [ "$current" != "$APPROVED_ALEMBIC_HEAD" ]; then
  echo "verify-migration-head: database revision '$current' is not the approved head '$APPROVED_ALEMBIC_HEAD'" >&2
  echo "Refusing: the database is ahead of or behind the reviewed revision." >&2
  exit 1
fi

echo "verify-migration-head: candidate and database both at approved head '$APPROVED_ALEMBIC_HEAD'"
