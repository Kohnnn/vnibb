#!/usr/bin/env bash
# Refuse a migration the approved transition does not cover, BEFORE it is applied.
#
# `alembic upgrade head` moves the database to whatever head the candidate image
# ships, so checking `alembic current` afterwards cannot stop an unreviewed
# migration from having already run. This gate runs first and asserts one exact
# approved transition: the database's applied revision must be the approved FROM,
# and the candidate image's own head must be the approved TO.
#
# Two output facts drive it, and both are easy to get wrong:
#   * `alembic heads` prints "<rev> (head)".
#   * `alembic current` prints the bare "<rev>" when the applied revision is not a
#     head, and only appends " (head)" when it is. A parser that accepts only
#     "(head)" reads a real applied revision as an empty database and lets the
#     upgrade through, so every applied revision is parsed here.
#
# Read-only: `heads` needs no database, and `current` only reads.
#
# Usage:
#   APPROVED_ALEMBIC_FROM=<rev|none> APPROVED_ALEMBIC_HEAD=<rev> \
#     bash scripts/oracle/verify-migration-head.sh
set -euo pipefail

: "${APPROVED_ALEMBIC_HEAD:?Set APPROVED_ALEMBIC_HEAD to the approved target revision}"
: "${APPROVED_ALEMBIC_FROM:?Set APPROVED_ALEMBIC_FROM to the approved starting revision, or 'none' for a fresh database}"

# Both approved values must be single real revisions; 'none' is only valid for FROM.
if ! printf '%s' "$APPROVED_ALEMBIC_HEAD" | grep -Eq '^[A-Za-z0-9_]{4,}$'; then
  echo "verify-migration-head: APPROVED_ALEMBIC_HEAD is not a single revision id" >&2
  exit 2
fi
if [ "$APPROVED_ALEMBIC_FROM" != "none" ] \
   && ! printf '%s' "$APPROVED_ALEMBIC_FROM" | grep -Eq '^[A-Za-z0-9_]{4,}$'; then
  echo "verify-migration-head: APPROVED_ALEMBIC_FROM must be a single revision id or 'none'" >&2
  exit 2
fi
# FROM == HEAD is a code-only release: nothing to migrate, but it is only valid if
# the candidate image and the database are both verified at that exact revision.
# That falls out of the checks below, so it is a verified no-op, not a bypass.


COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-deployment/env.oracle}"
DOCKER_BIN="${DOCKER_BIN:-docker}"

alembic_read() {
  "$DOCKER_BIN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    run --rm --no-deps --entrypoint alembic migrate -c /app/alembic.ini "$1"
}

# One revision id per line from stdin, stripping a trailing "(head)"/"(branchpoint)"
# and any whitespace. A bare applied revision is kept. Hex/alnum ids of 4+ chars
# keep ordinary log words out of the result.
parse_revisions() {
  sed -n 's/^[[:space:]]*\([A-Za-z0-9_]\{4,\}\)[[:space:]]*\(([^)]*)\)\{0,1\}[[:space:]]*$/\1/p' \
    | sort -u
}

if ! heads_output="$(alembic_read heads 2>/dev/null)"; then
  echo "verify-migration-head: 'alembic heads' failed; refusing without reading the candidate" >&2
  exit 1
fi
candidate_heads="$(printf '%s\n' "$heads_output" | parse_revisions)"

if [ -z "$candidate_heads" ]; then
  echo "verify-migration-head: could not read the candidate image's migration heads" >&2
  exit 1
fi
if [ "$(printf '%s\n' "$candidate_heads" | grep -c .)" -ne 1 ]; then
  echo "verify-migration-head: candidate has multiple heads, refusing an unreviewed merge:" >&2
  printf '  %s\n' $candidate_heads >&2
  exit 1
fi
if [ "$candidate_heads" != "$APPROVED_ALEMBIC_HEAD" ]; then
  echo "verify-migration-head: candidate image head '$candidate_heads' is not the approved head '$APPROVED_ALEMBIC_HEAD'" >&2
  echo "Refusing: applying it would run an unreviewed migration before any check could see it." >&2
  exit 1
fi

# `current` exit status separates "nothing applied" from a failed read.
if ! current_output="$(alembic_read current 2>/dev/null)"; then
  echo "verify-migration-head: 'alembic current' failed; refusing to assume an empty database" >&2
  exit 1
fi
applied="$(printf '%s\n' "$current_output" | parse_revisions)"

# Revisions reported in a form this gate cannot read are not evidence of "none".
if [ -z "$applied" ] && printf '%s' "$current_output" | grep -q 'Rev:'; then
  echo "verify-migration-head: 'alembic current' reported revisions that could not be parsed" >&2
  exit 1
fi
if [ -n "$applied" ] && [ "$(printf '%s\n' "$applied" | grep -c .)" -ne 1 ]; then
  echo "verify-migration-head: database reports multiple applied revisions:" >&2
  printf '  %s\n' $applied >&2
  exit 1
fi

if [ "$APPROVED_ALEMBIC_FROM" = "none" ]; then
  if [ -n "$applied" ]; then
    echo "verify-migration-head: approved transition starts from an empty database, but the database is at '$applied'" >&2
    exit 1
  fi
else
  if [ -z "$applied" ]; then
    echo "verify-migration-head: approved transition starts at '$APPROVED_ALEMBIC_FROM', but the database has no applied revision" >&2
    exit 1
  fi
  if [ "$applied" != "$APPROVED_ALEMBIC_FROM" ]; then
    echo "verify-migration-head: database is at '$applied', not the approved starting revision '$APPROVED_ALEMBIC_FROM'" >&2
    echo "Refusing: the database is ahead of or behind the reviewed transition." >&2
    exit 1
  fi
fi

if [ "$APPROVED_ALEMBIC_FROM" = "$APPROVED_ALEMBIC_HEAD" ]; then
  echo "verify-migration-head: no-op release; candidate image and database both verified at '$APPROVED_ALEMBIC_HEAD'"
else
  echo "verify-migration-head: approved transition ${APPROVED_ALEMBIC_FROM} -> ${APPROVED_ALEMBIC_HEAD} confirmed on the candidate image and database"
fi
