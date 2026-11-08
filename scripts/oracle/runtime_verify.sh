#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${TIMEOUT:-15}"
EXPECTED_DATA_BACKEND="${EXPECTED_DATA_BACKEND:-postgres}"
EXPECTED_ANON_DASHBOARD_WRITES="${EXPECTED_ANON_DASHBOARD_WRITES:-true}"
EXPECTED_RELEASE_REVISION="${EXPECTED_RELEASE_REVISION:-}"
EXPECTED_IMAGE_REPOSITORY="${EXPECTED_IMAGE_REPOSITORY:-${VNIBB_API_IMAGE_REPOSITORY:-}}"
EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-${VNIBB_API_IMAGE_DIGEST:-}}"
API_CONTAINER_NAME="${API_CONTAINER_NAME:-vnibb-api}"
DASHBOARD_CLIENT_ID="${DASHBOARD_CLIENT_ID:-browserlocalclient01}"
CORS_TEST_ORIGIN="${CORS_TEST_ORIGIN:-https://vnibb-web.vercel.app}"
CURL_BIN="${CURL_BIN:-}"
PYTHON_BIN="${PYTHON_BIN:-}"
NULL_SINK="/dev/null"
status=0

if [[ -z "$CURL_BIN" ]]; then
  if command -v curl.exe >/dev/null 2>&1; then
    CURL_BIN="curl.exe"
    NULL_SINK="NUL"
  else
    CURL_BIN="curl"
  fi
fi

if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python python3 py; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "No python interpreter found on PATH for runtime_verify.sh"
  exit 1
fi

read_json_field() {
  local json_payload="$1"
  local field_path="$2"

  "$PYTHON_BIN" - "$json_payload" "$field_path" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
value = payload
for key in sys.argv[2].split('.'):
    value = value[key]
if isinstance(value, bool):
    print(str(value).lower())
else:
    print(value)
PY
}

# Index rows must publish one coherent basis (#205/#206): change and
# change_pct re-derived from previous_close, and previous_close_session_date
# the first market session before the row's own session. A withheld base is
# the documented fail-closed state and must carry previous_close_unavailable_reason
# (previous_close_status is still accepted). INDEX_COHERENCE_ENFORCE=false only
# downgrades a coherence FAIL; transport and parse failures always fail.
INDEX_PATH="${INDEX_PATH:-/api/v1/market/indices}"
INDEX_COHERENCE_ENFORCE="${INDEX_COHERENCE_ENFORCE:-true}"
# Tolerance the API's own reconciliation uses (INDEX_CHANGE_TOLERANCE).
INDEX_LEVEL_TOLERANCE="${INDEX_LEVEL_TOLERANCE:-0.011}"
INDEX_PCT_TOLERANCE="${INDEX_PCT_TOLERANCE:-0.011}"

check_index_coherence() {
  local payload_file="$1"
  local level_tolerance="$2"
  local pct_tolerance="$3"

  "$PYTHON_BIN" - "$payload_file" "$level_tolerance" "$pct_tolerance" <<'PY'
import json
import sys
from datetime import date, timedelta

# Exchange-published closures for the only year the API certifies its calendar
# for; keep in step with apps/api/vnibb/core/market_calendar.py. A session year
# outside this set skips only the adjacency assertion, never the arithmetic.
HOLIDAYS = {
    date.fromisoformat(value)
    for value in (
        "2026-01-01", "2026-01-02",
        "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
        "2026-04-27", "2026-04-30", "2026-05-01",
        "2026-08-31", "2026-09-01", "2026-09-02",
    )
}
CERTIFIED_YEARS = {2026}
# The statuses `_reconcile_index_change_pct` actually emits. "observed" is not a
# withholding: it means an adjacent retained close was admitted as the base.
WITHHELD_REASONS = {
    "inconsistent_with_retained_change",
    "previous_session_not_retained",
    "previous_session_unconfirmed",
}
CHANGE_PCT_REASONS = {"inconsistent_with_retained_change"}

LEVEL_TOLERANCE = float(sys.argv[2])
PCT_TOLERANCE = float(sys.argv[3])


def session_of(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, ValueError) as parse_error:
    # Never downgraded by INDEX_COHERENCE_ENFORCE.
    print(f"index coherence ERROR      -> unreadable index payload: {parse_error}")
    sys.exit(2)

rows = payload.get("data") or []
failures = []
skipped_sessions = 0
verified = 0

if not rows:
    failures.append(f"no index rows in {payload.get('source')!r} payload")

for row in rows:
    name = row.get("index_name") or "?"
    close = row.get("current_value")
    base = row.get("previous_close")
    change = row.get("change")
    pct = row.get("change_pct")
    reason = row.get("previous_close_unavailable_reason") or row.get("previous_close_status")
    pct_reason = row.get("change_pct_status")

    # The base and the percentage are withheld independently: a row can publish
    # a percentage anchored on the base its own change implies while publishing
    # no base at all, and it can withhold a contradictory percentage while the
    # base reconciles. Check each field against its own status instead of
    # assuming one withheld field suppresses the other.
    if reason == "observed":
        # An adjacent retained close was admitted as the base; check it below.
        reason = None

    if reason is not None:
        if reason not in WITHHELD_REASONS:
            failures.append(f"{name}: unknown previous_close_unavailable_reason {reason!r}")
        if base is not None:
            failures.append(f"{name}: withheld base ({reason}) still publishes previous_close={base}")
    elif base is None:
        failures.append(
            f"{name}: no previous_close and no stated reason -> "
            f"current_value={close} change={change} change_pct={pct}"
        )

    if pct_reason is not None:
        if pct_reason not in CHANGE_PCT_REASONS:
            failures.append(f"{name}: unknown change_pct_status {pct_reason!r}")
        if pct is not None:
            failures.append(f"{name}: withheld change_pct ({pct_reason}) still publishes {pct}")

    if base is not None:
        if not all(
            isinstance(value, (int, float)) and not isinstance(value, bool)
            for value in (close, base, change)
        ):
            failures.append(
                f"{name}: unreadable level/base/change -> "
                f"current_value={close!r} previous_close={base!r} change={change!r}"
            )
        elif abs(close - base - change) > LEVEL_TOLERANCE:
            # An admitted base must explain the published change on its own.
            failures.append(
                f"{name}: current_value {close} - previous_close {base} = {close - base:.6f} "
                f"but change is {change} (tolerance {LEVEL_TOLERANCE})"
            )

    # A published percentage follows the base the row admits, otherwise the
    # base its own retained change implies (close - change). The published level
    # is never that base: the API derives the percentage from close - change.
    numeric = all(
        isinstance(value, (int, float)) and not isinstance(value, bool)
        for value in (close, change)
    )
    anchor = base if isinstance(base, (int, float)) and not isinstance(base, bool) else None
    if anchor in (None, 0) and numeric:
        anchor = close - change
    if pct is not None:
        if not numeric or anchor in (None, 0):
            failures.append(
                f"{name}: change_pct {pct!r} published with no base and no change to anchor it"
            )
        elif not isinstance(pct, (int, float)) or isinstance(pct, bool):
            failures.append(f"{name}: non-numeric change_pct {pct!r}")
        elif abs(pct - change / anchor * 100) > PCT_TOLERANCE:
            failures.append(
                f"{name}: change_pct {pct} != {change}/{anchor}*100 = {change / anchor * 100:.6f} "
                f"(tolerance {PCT_TOLERANCE})"
            )
    elif numeric and anchor not in (None, 0) and pct_reason is None:
        # The anchor exists and the API always derives the percentage from it,
        # so a missing percentage without a withholding status is a gap.
        failures.append(
            f"{name}: change_pct missing although base {anchor} anchors change {change}"
        )

    if numeric:
        verified += 1

    session = session_of(row.get("time"))
    if session is None:
        failures.append(f"{name}: unparseable session time {row.get('time')!r}")
        continue
    expected_session = session - timedelta(days=1)
    while expected_session.weekday() >= 5 or expected_session in HOLIDAYS:
        expected_session -= timedelta(days=1)
    claimed_session = session_of(row.get("previous_close_session_date"))
    if claimed_session is not None and claimed_session != expected_session:
        failures.append(
            f"{name}: previous_close_session_date {claimed_session} is not the session "
            f"before {session} (expected {expected_session})"
        )
    if session.year not in CERTIFIED_YEARS or expected_session.year not in CERTIFIED_YEARS:
        skipped_sessions += 1

for line in failures:
    print(f"index coherence FAIL       -> {line}")
if failures:
    sys.exit(1)
print(
    f"index coherence ok         -> {verified} rows reconcile"
    + (f"; {skipped_sessions} rows skipped the uncertified session-year check" if skipped_sessions else "")
)
PY
}

echo "Runtime verification target: ${BASE_URL}"

health_json="$($CURL_BIN -sS --max-time "$TIMEOUT" "${BASE_URL}/health/")"
printf 'health payload -> %s\n' "$health_json"

data_backend="$(read_json_field "$health_json" "providers.data_backend")"
anon_dashboard_writes="$(read_json_field "$health_json" "providers.allow_anonymous_dashboard_writes")"
release_revision="$(read_json_field "$health_json" "revision")"

printf 'resolved data backend      -> %s\n' "$data_backend"
printf 'anonymous dashboard writes -> %s\n' "$anon_dashboard_writes"
printf 'release revision           -> %s\n' "$release_revision"

if [[ -n "$EXPECTED_RELEASE_REVISION" && "$release_revision" != "$EXPECTED_RELEASE_REVISION" ]]; then
  echo "Expected release revision ${EXPECTED_RELEASE_REVISION}, got ${release_revision}"
  status=1
fi

if [[ "$data_backend" != "$EXPECTED_DATA_BACKEND" ]]; then
  echo "Expected data backend ${EXPECTED_DATA_BACKEND}, got ${data_backend}"
  status=1
fi

if [[ "$anon_dashboard_writes" != "$EXPECTED_ANON_DASHBOARD_WRITES" ]]; then
  echo "Expected allow_anonymous_dashboard_writes=${EXPECTED_ANON_DASHBOARD_WRITES}, got ${anon_dashboard_writes}"
  status=1
fi

if [[ "$anon_dashboard_writes" != "$EXPECTED_ANON_DASHBOARD_WRITES" ]]; then
  echo "Expected allow_anonymous_dashboard_writes=${EXPECTED_ANON_DASHBOARD_WRITES}, got ${anon_dashboard_writes}"
  status=1
fi

if [[ -n "$EXPECTED_IMAGE_REPOSITORY$EXPECTED_IMAGE_DIGEST" ]]; then
  if [[ -z "$EXPECTED_IMAGE_REPOSITORY" || -z "$EXPECTED_IMAGE_DIGEST" ]]; then
    echo "Set both EXPECTED_IMAGE_REPOSITORY and EXPECTED_IMAGE_DIGEST to verify the deployed image"
    status=1
  elif ! command -v docker >/dev/null 2>&1; then
    echo "Docker unavailable; cannot verify deployed image digest"
    status=1
  else
    expected_image="${EXPECTED_IMAGE_REPOSITORY}@${EXPECTED_IMAGE_DIGEST}"
    if ! configured_image="$(docker inspect --format '{{.Config.Image}}' "$API_CONTAINER_NAME" 2>/dev/null)"; then
      echo "Unable to inspect deployed API container ${API_CONTAINER_NAME} for image digest verification"
      status=1
    elif [[ "$configured_image" != "$expected_image" ]]; then
      echo "Expected configured image ${expected_image}, got ${configured_image}"
      status=1
    else
      printf 'configured image digest   -> %s\n' "$EXPECTED_IMAGE_DIGEST"
    fi
  fi
fi

dashboard_code="$($CURL_BIN -sS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" \
  -H "X-VNIBB-Client-ID: ${DASHBOARD_CLIENT_ID}" \
  "${BASE_URL}/api/v1/dashboard/" || true)"
printf 'dashboard anon endpoint    -> %s\n' "$dashboard_code"

if [[ "$dashboard_code" != "200" ]]; then
  echo "Expected anonymous dashboard endpoint to return 200"
  status=1
fi

cors_headers="$($CURL_BIN -sS -D - -o "$NULL_SINK" --max-time "$TIMEOUT" \
  -X OPTIONS "${BASE_URL}/api/v1/dashboard/" \
  -H "Origin: ${CORS_TEST_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: X-VNIBB-Client-ID" || true)"

printf 'dashboard cors preflight   -> %s\n' "$CORS_TEST_ORIGIN"

if ! printf '%s\n' "$cors_headers" | grep -qi "access-control-allow-origin: ${CORS_TEST_ORIGIN}"; then
  echo "Expected dashboard CORS preflight to allow origin ${CORS_TEST_ORIGIN}"
  status=1
fi

if ! printf '%s\n' "$cors_headers" | grep -qi "access-control-allow-headers: .*x-vnibb-client-id"; then
  echo "Expected dashboard CORS preflight to allow X-VNIBB-Client-ID"
  status=1
fi

if [[ -n "${MCP_HEALTH_URL:-}" ]]; then
  mcp_code="$($CURL_BIN -sS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" \
    "${MCP_HEALTH_URL}" || true)"
  printf 'mcp health endpoint        -> %s\n' "$mcp_code"
  if [[ "$mcp_code" != "200" ]]; then
    echo "Expected MCP health endpoint ${MCP_HEALTH_URL} to return 200"
    status=1
  fi
fi
index_payload_file="$(mktemp "${TMPDIR:-/tmp}/vnibb-index-coherence.XXXXXX")"
trap 'rm -f "$index_payload_file"' EXIT
if ! "$CURL_BIN" -sSk --max-time "$TIMEOUT" -o "$index_payload_file" \
  "${BASE_URL}${INDEX_PATH}" || [[ ! -s "$index_payload_file" ]]; then
  echo "Expected index endpoint ${INDEX_PATH} to return a payload"
  status=1
else
  printf 'index endpoint             -> %s\n' "$INDEX_PATH"
  # A failing checker under `set -e` must still have its report printed.
  if index_result="$(check_index_coherence "$index_payload_file" "$INDEX_LEVEL_TOLERANCE" "$INDEX_PCT_TOLERANCE")"; then
    index_rc=0
  else
    index_rc=$?
  fi
  [[ -n "$index_result" ]] && printf '%s\n' "$index_result"
  if [[ "$index_rc" -eq 1 ]]; then
    if [[ "$INDEX_COHERENCE_ENFORCE" == "true" ]]; then
      status=1
    else
      echo "index coherence failure not enforced (INDEX_COHERENCE_ENFORCE=${INDEX_COHERENCE_ENFORCE})"
    fi
  elif [[ "$index_rc" -ne 0 ]]; then
    # Transport or parse failure: never downgraded by the opt-out.
    status=1
  fi
fi

exit "$status"
