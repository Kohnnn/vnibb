"""The documented MCP smoke commands must actually run.

Issue #256: every published host/container invocation omitted `EXPECTED_REVISION`,
which the wrapper requires before any network call, and the deployment guide listed
only `mcp`/`httpx` while the acceptance runner also imports `jsonschema`.

These tests parse the documented commands and execute the documented shape against
a disposable loopback TLS fixture. No production service, provider or credential
participates; the fixture certificate is generated per run.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import ssl
import subprocess
import sys
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[4]
SMOKE = ROOT / "scripts" / "oracle" / "mcp_smoke_test.sh"
DEPLOYMENT_DOC = ROOT / "docs" / "VNIBB_MCP_DEPLOYMENT.md"
READONLY_DOC = ROOT / "docs" / "VNIBB_MCP_READONLY.md"
RUNBOOK = ROOT / "docs" / "oracle_runbook.md"
FIXTURE_REVISION = "a" * 40
MISMATCH_REVISION = "b" * 40
FIXTURE_BEARER = "fixture-bearer-5f3c1d-do-not-print"


def documented_commands(doc: Path) -> list[str]:
    """Every single-line command that invokes the smoke wrapper."""
    text = doc.read_text(encoding="utf-8")
    commands = []
    for block in re.findall(r"```(?:bash|sh)\n(.*?)```", text, flags=re.DOTALL):
        commands.extend(
            line.strip()
            for line in block.splitlines()
            if "mcp_smoke_test.sh" in line and not line.strip().startswith("#")
        )
    return commands


@pytest.mark.parametrize("doc", [DEPLOYMENT_DOC, READONLY_DOC, RUNBOOK], ids=lambda p: p.name)
def test_documented_smoke_commands_supply_an_expected_revision(doc: Path) -> None:
    commands = documented_commands(doc)
    assert commands, f"{doc.name} should document at least one smoke invocation"
    for command in commands:
        assert "EXPECTED_REVISION" in command, f"missing EXPECTED_REVISION: {command}"
        assert "VNIBB_MCP_SHARED_BEARER_TOKEN" in command or "PYTHON_MODE=container" in command


def test_deployment_docs_list_every_host_prerequisite() -> None:
    text = DEPLOYMENT_DOC.read_text(encoding="utf-8")
    install = re.search(r"```bash\npython3 -m pip install ([^\n]+)\n```", text)
    assert install, "the deployment guide must document the host client install"
    for module in ("mcp", "httpx", "jsonschema"):
        assert module in install.group(1), module
    assert ".release-revision" in text
    assert "Never copy the value from `/health`" in text
    assert "prove process availability only" in text


def test_readonly_doc_keeps_health_separate_from_acceptance() -> None:
    text = READONLY_DOC.read_text(encoding="utf-8")
    smoke_section = text.split("## OCI smoke checks")[1]
    assert "jsonschema" in smoke_section
    assert "never a value read back from `/health`" in smoke_section
    assert "Health alone is never connectivity proof" in smoke_section


class _Fixture(BaseHTTPRequestHandler):
    """Minimal MCP deployment: authenticated transport is absent, denial and health exist."""

    seen: list[tuple[str, str, str]] = []
    revision = FIXTURE_REVISION

    def log_message(self, *_args) -> None:  # keep pytest output clean
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        type(self).seen.append(("GET", self.path, self.headers.get("authorization", "")))
        if self.path == "/health":
            self._send(
                200,
                {
                    "ok": True,
                    "read_only": True,
                    "revision": type(self).revision,
                    "database": {"configured": False},
                    # Deliberate credential in a payload: the runner must redact it.
                    "leaked_hint": f"bearer={FIXTURE_BEARER}",
                },
            )
            return
        self._send(404, {"error": True})

    def do_POST(self) -> None:  # noqa: N802
        type(self).seen.append(("POST", self.path, self.headers.get("authorization", "")))
        self._send(401, {"error": True, "message": "missing bearer"})


def _certificate(directory: Path) -> Path:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    pem = directory / "fixture-ca.pem"
    pem.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (directory / "fixture-ca.key").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return pem


@pytest.fixture
def fixture(tmp_path: Path):
    """Disposable loopback TLS MCP deployment plus a private HOME for the client run."""
    pem = _certificate(tmp_path)
    home = tmp_path / "home"
    home.mkdir()
    _Fixture.seen = []
    _Fixture.revision = FIXTURE_REVISION
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Fixture)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(pem), str(tmp_path / "fixture-ca.key"))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"https://127.0.0.1:{server.server_address[1]}", pem, home
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _run(base_url: str, *, revision: str | None, ca: Path | None, home: Path) -> subprocess.CompletedProcess[str]:
    """Clean environment: private HOME, explicit client deps, no inherited MCP settings."""
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("VNIBB_MCP_", "MCP_URL", "HEALTH_URL", "EXPECTED_REVISION", "SSL_CERT_FILE"))
    }
    environment.update(
        PYTHON_MODE=f"host:{sys.executable}",
        BASE_URL=base_url,
        MCP_URL=f"{base_url}/mcp",
        HEALTH_URL=f"{base_url}/health",
        VNIBB_MCP_SHARED_BEARER_TOKEN=FIXTURE_BEARER,
        TIMEOUT="5",
        HOME=str(home),
    )
    if revision is not None:
        environment["EXPECTED_REVISION"] = revision
    if ca is not None:
        environment["SSL_CERT_FILE"] = str(ca)
    return subprocess.run(
        ["bash", str(SMOKE)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=180,
    )


def _report(stdout: str) -> dict:
    return json.loads(stdout[stdout.index("{") :])


def test_missing_revision_fails_before_any_request(fixture) -> None:
    base_url, ca, home = fixture
    completed = _run(base_url, revision=None, ca=ca, home=home)

    assert completed.returncode == 1
    assert "EXPECTED_REVISION" in completed.stderr
    assert _Fixture.seen == [], "the wrapper must not reach the service without a revision"


def test_health_revision_mismatch_fails_and_output_is_redacted(fixture) -> None:
    base_url, ca, home = fixture
    completed = _run(base_url, revision=MISMATCH_REVISION, ca=ca, home=home)
    report = _report(completed.stdout)
    checks = {check["name"]: check for check in report["checks"]}

    assert completed.returncode == 1
    assert checks["runtime_revision"]["status"] == "FAIL"
    assert checks["runtime_revision"]["detail"] == {"actual": FIXTURE_REVISION, "expected": MISMATCH_REVISION}
    assert checks["unauthenticated_denial"]["status"] == "PASS"
    # The health probe is unauthenticated, so the revision check is only a process identity check.
    assert ("GET", "/health", "") in _Fixture.seen
    assert any(path == "/mcp" for method, path, _ in _Fixture.seen if method == "POST")
    combined = completed.stdout + completed.stderr
    assert FIXTURE_BEARER not in combined
    assert "127.0.0.1" not in combined
    assert FIXTURE_BEARER not in json.dumps(report)


def test_matching_revision_passes_identity_but_not_acceptance(fixture) -> None:
    base_url, ca, home = fixture
    completed = _run(base_url, revision=FIXTURE_REVISION, ca=ca, home=home)
    report = _report(completed.stdout)
    checks = {check["name"]: check for check in report["checks"]}

    assert checks["runtime_revision"]["status"] == "PASS"
    # Process identity is not database/source/coverage acceptance: the run still fails.
    assert report["status"] == "FAIL"
    assert completed.returncode == 1
    assert report["health"]["revision"] == FIXTURE_REVISION
    assert report["health"]["leaked_hint"] == "bearer=<REDACTED>"


def test_untrusted_certificate_fails_closed_without_bypass(fixture) -> None:
    base_url, _ca, home = fixture
    completed = _run(base_url, revision=FIXTURE_REVISION, ca=None, home=home)

    assert completed.returncode == 1
    assert "CERTIFICATE_VERIFY_FAILED" in completed.stdout
    assert FIXTURE_BEARER not in completed.stdout + completed.stderr
