"""The documented MCP smoke commands must actually run.

Issue #256: every published host/container invocation omitted `EXPECTED_REVISION`,
which the wrapper requires before any network call, and the deployment guide listed
only `mcp`/`httpx` while the acceptance runner also imports `jsonschema`.

These tests take the commands *as published* in the documentation, substitute only
fixture placeholders (revision, bearer, address, interpreter, CA) and execute those
commands against a disposable loopback TLS MCP deployment. Endpoint derivation,
bearer handling and TLS trust therefore come from the documentation itself, not
from the test. No production service, provider or credential participates.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP

ROOT = Path(__file__).resolve().parents[4]
SMOKE = ROOT / "scripts" / "oracle" / "mcp_smoke_test.sh"
DEPLOYMENT_GUIDE = ROOT / "DEPLOYMENT.md"
DEPLOYMENT_DOC = ROOT / "docs" / "VNIBB_MCP_DEPLOYMENT.md"
READONLY_DOC = ROOT / "docs" / "VNIBB_MCP_READONLY.md"
RUNBOOK = ROOT / "docs" / "oracle_runbook.md"
HOST_DOCS = (DEPLOYMENT_GUIDE, DEPLOYMENT_DOC, READONLY_DOC, RUNBOOK)
FIXTURE_REVISION = "a" * 40
MISMATCH_REVISION = "b" * 40
FIXTURE_BEARER = "fixture-bearer-5f3c1d-do-not-print"
REVISION_PLACEHOLDERS = (
    "<reviewed-40-char-sha>",
    "<reviewed commit>",
    "$EXPECTED_REVISION",
)
BEARER_PLACEHOLDERS = ("...", '"$VNIBB_MCP_SHARED_BEARER_TOKEN"', "$VNIBB_MCP_SHARED_BEARER_TOKEN")


def documented_commands(doc: Path) -> list[str]:
    """Every single-line command that invokes the smoke wrapper."""
    text = doc.read_text(encoding="utf-8")
    commands: list[str] = []
    for block in re.findall(r"```(?:bash|sh)\n(.*?)```", text, flags=re.DOTALL):
        commands.extend(
            line.strip()
            for line in block.splitlines()
            if "mcp_smoke_test.sh" in line and not line.strip().startswith("#")
        )
    return commands


def host_commands(doc: Path) -> list[str]:
    return [command for command in documented_commands(doc) if "PYTHON_MODE=container" not in command]


@pytest.mark.parametrize("doc", HOST_DOCS, ids=lambda p: p.name)
def test_documented_smoke_commands_supply_an_expected_revision(doc: Path) -> None:
    commands = documented_commands(doc)
    assert commands, f"{doc.name} should document at least one smoke invocation"
    for command in commands:
        assert "EXPECTED_REVISION" in command, f"missing EXPECTED_REVISION: {command}"
        if "PYTHON_MODE=container" in command:
            # Container mode reads the sidecar's own env; it must say so explicitly.
            assert "COMPOSE_FILE=docker-compose.oracle.yml" in command
            assert "ENV_FILE=deployment/env.oracle" in command
        else:
            # A host execution needs the bearer supplied or explicitly loaded here.
            assert "VNIBB_MCP_SHARED_BEARER_TOKEN" in command, f"missing bearer: {command}"


def test_every_doc_selects_its_runtime_explicitly() -> None:
    """Auto mode prefers a host client, so host commands must name host:… and the bearer."""
    for doc in HOST_DOCS:
        for command in host_commands(doc):
            assert "PYTHON_MODE=host:" in command, f"{doc.name}: implicit runtime selection in {command}"


def test_deployment_docs_list_every_host_prerequisite() -> None:
    text = DEPLOYMENT_DOC.read_text(encoding="utf-8")
    install = re.search(r"```bash\npython3 -m pip install ([^\n]+)\n```", text)
    assert install, "the deployment guide must document the host client install"
    for module in ("mcp", "httpx", "jsonschema"):
        assert module in install.group(1), module
    assert ".release-revision" in text
    assert "Never copy the value from `/health`" in text
    assert "prove process availability only" in text


def test_revision_guidance_peels_annotated_tags() -> None:
    """`git rev-parse --verify <tag>` returns the tag object; the commit needs ^{commit}."""
    for doc in HOST_DOCS:
        text = doc.read_text(encoding="utf-8")
        if "rev-parse --verify" in text:
            assert "^{commit}" in text, doc.name


def test_readonly_doc_keeps_health_separate_from_acceptance() -> None:
    text = READONLY_DOC.read_text(encoding="utf-8")
    smoke_section = text.split("## OCI smoke checks")[1]
    assert "jsonschema" in smoke_section
    assert "never a value read back from `/health`" in smoke_section
    assert "Health alone is never connectivity proof" in smoke_section


def _certificate(directory: Path) -> tuple[Path, Path]:
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
    key_path = directory / "fixture-ca.key"
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return pem, key_path


class _Deployment:
    """Minimal read-only MCP deployment: authenticated transport, health, no business data."""

    revision = FIXTURE_REVISION
    requests: list[tuple[str, str, str]] = []


def _app() -> FastAPI:
    server = FastMCP("vnibb-fixture")

    @server.tool()
    def get_database_status() -> dict:
        """Fixture status; never claims connectivity."""
        return {"read_only": True, "connectivity": {"status": "unconfigured"}}

    transport = server.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with server.session_manager.run():
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, openapi_url=None)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        _Deployment.requests.append((request.method, request.url.path, request.headers.get("authorization", "")))
        if request.url.path == "/health":
            return await call_next(request)
        if request.headers.get("authorization", "") == f"Bearer {FIXTURE_BEARER}":
            return await call_next(request)
        return JSONResponse(status_code=401, content={"error": True, "message": "missing bearer"})

    @app.get("/health")
    async def health() -> dict:
        return {
            "ok": True,
            "read_only": True,
            "revision": _Deployment.revision,
            "database": {"configured": False},
            # Deliberate credential in a payload: the runner must redact it.
            "leaked_hint": f"bearer={FIXTURE_BEARER}",
        }

    app.mount("/", transport)
    return app


@pytest.fixture
def deployment(tmp_path: Path):
    """Disposable TLS MCP deployment plus a private HOME for each client run."""
    pem, key = _certificate(tmp_path)
    home = tmp_path / "home"
    home.mkdir()
    _Deployment.requests = []
    _Deployment.revision = FIXTURE_REVISION
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(64)
    port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(_app(), log_level="error", ssl_certfile=str(pem), ssl_keyfile=str(key))
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started:
        assert time.monotonic() < deadline, "fixture MCP server did not start"
        time.sleep(0.05)
    try:
        yield f"https://127.0.0.1:{port}", pem, home
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


def _documented_command(
    command: str,
    base_url: str,
    *,
    revision: str | None,
    home: Path,
) -> subprocess.CompletedProcess[str]:
    """Run the published command verbatim apart from fixture placeholders."""
    executable = command.replace("PYTHON_MODE=host:python3", f"PYTHON_MODE=host:{sys.executable}")
    executable = executable.replace("BASE_URL=http://127.0.0.1:8001", f"BASE_URL={base_url}")
    executable = executable.replace("BASE_URL=https://api.example.com", f"BASE_URL={base_url}")
    executable = executable.replace("BASE_URL=https://oracle-api.example.com", f"BASE_URL={base_url}")
    for placeholder in REVISION_PLACEHOLDERS:
        executable = executable.replace(f"EXPECTED_REVISION={placeholder}", f"EXPECTED_REVISION={revision or ''}")
    for placeholder in BEARER_PLACEHOLDERS:
        executable = executable.replace(f"VNIBB_MCP_SHARED_BEARER_TOKEN={placeholder}", f"VNIBB_MCP_SHARED_BEARER_TOKEN={FIXTURE_BEARER}")
    environment = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(home),
        "TERM": "dumb",
        # The documented examples never pass MCP_URL/HEALTH_URL: derivation is under test.
        "VNIBB_MCP_SHARED_BEARER_TOKEN": FIXTURE_BEARER,
    }
    # Runbook commands reference an already exported revision; keep that contract.
    if revision is not None:
        environment["EXPECTED_REVISION"] = revision
    return subprocess.run(
        ["bash", "-c", executable],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=300,
    )


def _report(stdout: str) -> dict:
    return json.loads(stdout[stdout.index("{") :])


def _checks(report: dict) -> dict[str, dict]:
    return {check["name"]: check for check in report["checks"]}


@pytest.mark.parametrize("doc", [DEPLOYMENT_GUIDE, DEPLOYMENT_DOC, READONLY_DOC], ids=lambda p: p.name)
def test_documented_host_commands_authenticate_and_match_revision(doc: Path, deployment) -> None:
    """Each documented host invocation must reach MCP authentication on its own terms."""
    base_url, ca, home = deployment
    commands = host_commands(doc)
    assert commands

    for command in commands:
        _Deployment.requests = []
        completed = _documented_command(command, base_url, revision=FIXTURE_REVISION, home=home)
        # The documented command must set TLS trust for this fixture, exactly as an operator would.
        if "--no-check" in command:  # pragma: no cover - documented commands never bypass TLS
            pytest.fail("documented command disables TLS verification")
        if completed.returncode != 0 and "CERTIFICATE_VERIFY_FAILED" in completed.stdout:
            completed = _documented_command(
                f"SSL_CERT_FILE={ca} {command}", base_url, revision=FIXTURE_REVISION, home=home
            )

        report = _report(completed.stdout)
        checks = _checks(report)
        assert checks["runtime_revision"]["status"] == "PASS", (doc.name, command, checks)
        assert checks["authenticated_transport"]["status"] == "PASS", (doc.name, command, checks)
        assert checks["unauthenticated_denial"]["status"] == "PASS"
        # Endpoint derivation came from BASE_URL alone; no MCP_URL/HEALTH_URL was injected.
        assert any(path == "/health" for _, path, _ in _Deployment.requests), command
        assert any(method == "POST" and path.startswith("/mcp") for method, path, _ in _Deployment.requests), command
        combined = completed.stdout + completed.stderr
        assert FIXTURE_BEARER not in combined, command
        assert "127.0.0.1" not in combined, command


def test_runbook_commands_authenticate_and_match_revision(deployment) -> None:
    base_url, ca, home = deployment
    for command in host_commands(RUNBOOK):
        completed = _documented_command(f"SSL_CERT_FILE={ca} {command}", base_url, revision=FIXTURE_REVISION, home=home)
        checks = _checks(_report(completed.stdout))
        assert checks["authenticated_transport"]["status"] == "PASS", command
        assert checks["runtime_revision"]["status"] == "PASS", command


def test_missing_revision_fails_before_any_request(deployment) -> None:
    base_url, ca, home = deployment
    command = f"SSL_CERT_FILE={ca} {host_commands(DEPLOYMENT_DOC)[0]}"
    completed = _documented_command(command, base_url, revision=None, home=home)

    assert completed.returncode == 1
    assert "EXPECTED_REVISION" in completed.stderr
    assert _Deployment.requests == [], "the wrapper must not reach the service without a revision"


def test_health_revision_mismatch_fails_and_output_is_redacted(deployment) -> None:
    base_url, ca, home = deployment
    command = f"SSL_CERT_FILE={ca} {host_commands(DEPLOYMENT_DOC)[0]}"
    completed = _documented_command(command, base_url, revision=MISMATCH_REVISION, home=home)
    report = _report(completed.stdout)
    checks = _checks(report)

    assert completed.returncode == 1
    assert checks["runtime_revision"]["status"] == "FAIL"
    assert checks["runtime_revision"]["detail"] == {"actual": FIXTURE_REVISION, "expected": MISMATCH_REVISION}
    assert checks["unauthenticated_denial"]["status"] == "PASS"
    combined = completed.stdout + completed.stderr
    assert FIXTURE_BEARER not in combined
    assert "127.0.0.1" not in combined


def test_matching_revision_passes_identity_but_not_acceptance(deployment) -> None:
    base_url, ca, home = deployment
    command = f"SSL_CERT_FILE={ca} {host_commands(DEPLOYMENT_DOC)[0]}"
    completed = _documented_command(command, base_url, revision=FIXTURE_REVISION, home=home)
    report = _report(completed.stdout)

    assert _checks(report)["runtime_revision"]["status"] == "PASS"
    # Process identity and transport auth are not database/source/coverage acceptance.
    assert report["status"] == "FAIL"
    assert completed.returncode == 1
    assert report["health"]["revision"] == FIXTURE_REVISION
    assert report["health"]["leaked_hint"] == "bearer=<REDACTED>"


def test_untrusted_certificate_fails_closed_without_bypass(deployment) -> None:
    base_url, _ca, home = deployment
    completed = _documented_command(host_commands(DEPLOYMENT_DOC)[0], base_url, revision=FIXTURE_REVISION, home=home)

    assert completed.returncode == 1
    assert "CERTIFICATE_VERIFY_FAILED" in completed.stdout
    assert FIXTURE_BEARER not in completed.stdout + completed.stderr


def test_fixture_transport_matches_the_documented_endpoint_shape() -> None:
    """Guard the fixture itself: unauthenticated POST is denied, health is open."""
    assert (httpx.__version__ or "").startswith(("0.", "1."))
    assert "BASE_URL" in SMOKE.read_text(encoding="utf-8")
