#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="$root/scripts/oracle/lb_canary_validate.sh"
healthcheck="$root/scripts/oracle/healthcheck.sh"
tmp="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost' >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$tmp/unrelated-key.pem" -out "$tmp/unrelated-ca.pem" -subj '/CN=unrelated test CA' >/dev/null 2>&1
cat >"$tmp/server.py" <<'PY'
import http.server
import ssl
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(sys.argv[3], "a") as requests:
            requests.write("GET " + self.path + "\n")
        self.send_response(200)
        self.end_headers()
    def do_OPTIONS(self):
        with open(sys.argv[3], "a") as requests:
            requests.write("OPTIONS " + self.path + "\n")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "https://probe.invalid")
        self.end_headers()
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(sys.argv[1], sys.argv[2])
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_address[1], flush=True)
server.serve_forever()
PY
python3 "$tmp/server.py" "$tmp/cert.pem" "$tmp/key.pem" "$tmp/requests.log" >"$tmp/port" 2>"$tmp/server.log" &
server_pid=$!
for _ in {1..50}; do
  [[ -s "$tmp/port" ]] && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$tmp/server.log" >&2; exit 1; }
  sleep 0.1
done
[[ -s "$tmp/port" ]] || { echo 'loopback TLS fixture did not start' >&2; exit 1; }
port="$(<"$tmp/port")"
# A test-only curl wrapper maps the validator's HTTPS port 443 to this loopback server.
cat >"$tmp/curl" <<'SH'
#!/usr/bin/env bash
args=()
for arg in "$@"; do
  if [[ "$arg" == https://localhost/* ]]; then arg="https://localhost:${TEST_PORT}${arg#https://localhost}"; fi
  args+=("$arg")
done
exec /usr/bin/curl --noproxy '*' --connect-to "localhost:443:localhost:${TEST_PORT}" "${args[@]}"
SH
chmod +x "$tmp/curl"

export PATH="$tmp:$PATH" TEST_PORT="$port" LB_PUBLIC_IP=127.0.0.1 HOSTNAME=localhost CORS_TEST_ORIGIN=https://probe.invalid TIMEOUT=1 CURL_BIN="$tmp/curl"
if CURL_CA_BUNDLE="$tmp/unrelated-ca.pem" bash "$validator" >"$tmp/untrusted.out" 2>&1; then
  echo 'FAIL: validator accepted an untrusted self-signed certificate' >&2
  cat "$tmp/untrusted.out" >&2
  exit 1
fi
if ! grep -q 'curl: (60)' "$tmp/untrusted.out" || grep -q 'curl: (77)' "$tmp/untrusted.out"; then
  echo 'FAIL: expected curl certificate verification error 60, not CA-load error' >&2
  cat "$tmp/untrusted.out" >&2
  exit 1
fi
if [[ -s "$tmp/requests.log" ]]; then
  echo 'FAIL: untrusted TLS reached HTTP handlers, including potentially CORS' >&2
  cat "$tmp/requests.log" >&2
  exit 1
fi
if ! grep -q 'LB canary validation failed' "$tmp/untrusted.out"; then
  echo 'FAIL: untrusted certificate did not produce a validation failure' >&2
  cat "$tmp/untrusted.out" >&2
  exit 1
fi
printf 'PASS: untrusted self-signed certificate rejected\n'
if CURL_CA_BUNDLE="$tmp/unrelated-ca.pem" BASE_URL="https://localhost" bash "$healthcheck" >"$tmp/health-untrusted.out" 2>&1; then
  echo 'FAIL: healthcheck accepted an untrusted certificate' >&2
  cat "$tmp/health-untrusted.out" >&2
  exit 1
fi
if ! grep -q 'curl: (60)' "$tmp/health-untrusted.out" || [[ -s "$tmp/requests.log" ]]; then
  echo 'FAIL: healthcheck bypassed TLS verification or reached HTTP handlers' >&2
  cat "$tmp/health-untrusted.out" "$tmp/requests.log" >&2
  exit 1
fi
if ! CURL_CA_BUNDLE="$tmp/cert.pem" BASE_URL="https://localhost" bash "$healthcheck" >"$tmp/health-trusted.out" 2>&1; then
  echo 'FAIL: healthcheck rejected explicitly trusted certificate' >&2
  cat "$tmp/health-trusted.out" >&2
  exit 1
fi
if [[ "$(wc -l < "$tmp/requests.log")" -ne 3 ]] || [[ "$(grep -c '^GET ' "$tmp/requests.log")" -ne 3 ]]; then
  echo 'FAIL: trusted healthcheck did not issue exactly three GET requests' >&2
  cat "$tmp/requests.log" >&2
  exit 1
fi
printf 'PASS: healthcheck rejects untrusted and accepts trusted TLS\n'

if ! CURL_CA_BUNDLE="$tmp/cert.pem" bash "$validator" >"$tmp/trusted.out" 2>&1; then
  echo 'FAIL: explicitly trusted loopback CA was not accepted' >&2
  cat "$tmp/trusted.out" >&2
  exit 1
fi
if ! grep -qi 'access-control-allow-origin: https://probe.invalid' "$tmp/trusted.out"; then
  echo 'FAIL: trusted CORS response was not reported' >&2
  cat "$tmp/trusted.out" >&2
  exit 1
fi
if [[ "$(wc -l < "$tmp/requests.log")" -ne 10 ]] || [[ "$(grep -c '^GET ' "$tmp/requests.log")" -ne 9 ]] || [[ "$(grep -c '^OPTIONS ' "$tmp/requests.log")" -ne 1 ]]; then
  echo 'FAIL: expected three healthcheck GETs, six canary GETs, and one OPTIONS request' >&2
  cat "$tmp/requests.log" >&2
  exit 1
fi
printf 'PASS: trusted loopback CA accepted with CORS\n'
