import asyncio
import copy
import socket
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import uvicorn
from httpx import AsyncClient
from jose import jwt
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.mcp import server
from vnibb.models.app_kv import AppKeyValue
from vnibb.services.matrix_observations import build_matrix_fixture
from vnibb.services.matrix_service import revoke_matrix_snapshot

JWT_SECRET = "matrix-mcp-test-signing-key-not-a-production-secret"
OWNER = "matrix-mcp-owner"
OTHER = "matrix-mcp-other"
SOURCE = "mcp-test-licensed-source"


def signed_token(user_id=OWNER, *, secret=JWT_SECRET, expired=False):
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": user_id,
            "email": "matrix-test@example.invalid",
            "aud": "authenticated",
            "role": "authenticated",
            "iat": now,
            "exp": now + timedelta(minutes=-5 if expired else 5),
        },
        secret,
        algorithm="HS256",
    )


@pytest.fixture
async def matrix_store(test_engine, monkeypatch):
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", factory)
    fixture = copy.deepcopy(build_matrix_fixture())
    snapshot = fixture["snapshot"]
    snapshot["synthetic"] = False
    for evidence in fixture["evidence"]:
        evidence["source"] = SOURCE
    async with factory() as db:
        db.add(
            AppKeyValue(
                key=f"matrix:snapshot:{snapshot['snapshot_id']}",
                value={"owner_id": OWNER, **fixture},
            )
        )
        await db.commit()
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", SOURCE)
    return fixture, factory


@pytest.fixture
async def matrix_http(monkeypatch):
    monkeypatch.setattr(server.settings, "supabase_jwt_secret", JWT_SECRET)
    monkeypatch.setattr(server.settings, "vnibb_mcp_shared_bearer_token", "deployment-shared")
    # SDK managers are single-lifespan objects; each test owns its own HTTP app.
    monkeypatch.setattr(server.mcp, "_session_manager", None)
    monkeypatch.setattr(
        server.mcp.settings,
        "transport_security",
        TransportSecuritySettings(allowed_hosts=["127.0.0.1:*"], allowed_origins=[]),
    )
    app = server.create_http_app()
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.setblocking(False)
    port = sock.getsockname()[1]
    config = uvicorn.Config(app, log_level="error", access_log=False, lifespan="on")
    process = uvicorn.Server(config)
    task = asyncio.create_task(process.serve(sockets=[sock]))
    try:
        async with asyncio.timeout(10):
            while not process.started:
                if task.done():
                    await task
                    raise RuntimeError("MCP test server exited before startup")
                await asyncio.sleep(0.01)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        process.should_exit = True
        try:
            await asyncio.wait_for(task, timeout=10)
        finally:
            sock.close()


@asynccontextmanager
async def connected_client(url, token):
    async with AsyncClient(headers={"Authorization": f"Bearer {token}"}) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session, http


def selection_args(fixture):
    snapshot = fixture["snapshot"]
    cell = next(cell for cell in snapshot["cells"] if cell["evidence_ids"])
    return {"snapshot_id": snapshot["snapshot_id"], "result_ids": [cell["result_id"]]}


def error_text(result):
    assert result.isError
    return " ".join(item.text for item in result.content if item.type == "text")


@pytest.mark.asyncio
async def test_official_http_client_reauthorizes_owner_other_and_revoked(matrix_http, matrix_store):
    fixture, factory = matrix_store
    args = selection_args(fixture)
    async with connected_client(matrix_http, signed_token()) as (session, http):
        result = await session.call_tool("get_matrix_selection", args)
        assert not result.isError
        packet = result.structuredContent
        cell = next(
            cell for cell in fixture["snapshot"]["cells"] if cell["result_id"] == args["result_ids"][0]
        )
        assert [row["result_id"] for row in packet["snapshot"]["cells"]] == [cell["result_id"]]
        returned_cell = packet["snapshot"]["cells"][0]
        assert returned_cell["result_revision"] == cell["result_revision"]
        assert returned_cell["payload"]["metrics"] == cell["payload"]["metrics"]
        assert packet["snapshot"]["revision"] == fixture["snapshot"]["revision"]
        assert {row["source"] for row in packet["evidence"]} == {SOURCE}

        http.headers["Authorization"] = f"Bearer {signed_token(OTHER)}"
        other_error = error_text(await session.call_tool("get_matrix_selection", args))
        assert "Matrix selection not found" in other_error
        missing_args = {**args, "snapshot_id": "00000000-0000-0000-0000-000000000099"}
        assert error_text(await session.call_tool("get_matrix_selection", missing_args)) == other_error

        http.headers["Authorization"] = f"Bearer {signed_token()}"
        assert not (await session.call_tool("get_matrix_selection", args)).isError
        async with factory() as db:
            await revoke_matrix_snapshot(db, OWNER, args["snapshot_id"])
        assert error_text(await session.call_tool("get_matrix_selection", args)) == other_error


@pytest.mark.asyncio
async def test_http_selection_rejects_duplicates_empty_and_foreign_results(matrix_http, matrix_store):
    fixture, _ = matrix_store
    args = selection_args(fixture)
    result_id = args["result_ids"][0]
    async with connected_client(matrix_http, signed_token()) as (session, _):
        for result_ids in ([], [result_id, result_id], [result_id] * 121):
            result = await session.call_tool("get_matrix_selection", {**args, "result_ids": result_ids})
            assert "Invalid Matrix selection" in error_text(result)
            assert result.structuredContent is None
        result = await session.call_tool(
            "get_matrix_selection", {**args, "result_ids": [result_id, "unowned-result"]}
        )
        assert "Matrix selection not found" in error_text(result)
        assert result.structuredContent is None


@pytest.mark.asyncio
async def test_matrix_export_rights_default_deny_exact_source_and_synthetic(
    matrix_http, matrix_store, monkeypatch
):
    fixture, factory = matrix_store
    args = selection_args(fixture)
    async with connected_client(matrix_http, signed_token()) as (session, _):
        monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)
        denied = await session.call_tool("get_matrix_selection", args)
        assert "Matrix source export is not permitted" in error_text(denied)
        assert denied.structuredContent is None
        monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "mcp-test-licensed")
        assert "not permitted" in error_text(await session.call_tool("get_matrix_selection", args))
        monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", SOURCE)
        assert not (await session.call_tool("get_matrix_selection", args)).isError
        monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)
        async with factory() as db:
            stored = await db.get(AppKeyValue, f"matrix:snapshot:{args['snapshot_id']}")
            value = copy.deepcopy(stored.value)
            value["snapshot"]["synthetic"] = True
            stored.value = value
            await db.commit()
        assert not (await session.call_tool("get_matrix_selection", args)).isError


@pytest.mark.asyncio
async def test_shared_bearer_keeps_market_access_but_never_matrix(matrix_http, matrix_store):
    fixture, _ = matrix_store
    async with connected_client(matrix_http, "deployment-shared") as (session, http):
        market = await session.call_tool("list_supported_collections", {})
        assert not market.isError
        assert "stock_prices" in market.structuredContent["collections"]
        args = selection_args(fixture)
        assert "verified user JWT" in error_text(await session.call_tool("get_matrix_selection", args))
        http.headers["Authorization"] = f"Bearer {signed_token()}"
        assert not (await session.call_tool("get_matrix_selection", args)).isError
        http.headers["Authorization"] = "Bearer deployment-shared"
        assert "verified user JWT" in error_text(await session.call_tool("get_matrix_selection", args))


@pytest.mark.asyncio
async def test_invalid_and_expired_jwt_cannot_enter_http_transport(matrix_http):
    async with AsyncClient() as client:
        for token in (signed_token(secret="wrong-signature"), signed_token(expired=True), "not-a-jwt"):
            response = await client.post(
                matrix_http,
                headers={"Authorization": f"Bearer {token}"},
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            )
            assert response.status_code == 401
            assert token not in response.text
        assert (await client.post(matrix_http)).status_code == 401


@pytest.mark.asyncio
async def test_anonymous_http_cannot_read_matrix_when_shared_guard_disabled(
    matrix_http, matrix_store, monkeypatch
):
    monkeypatch.setattr(server.settings, "vnibb_mcp_shared_bearer_token", "")
    fixture, _ = matrix_store
    async with AsyncClient() as http:
        async with streamable_http_client(matrix_http, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool("get_matrix_selection", selection_args(fixture))
                assert "verified user JWT" in error_text(result)


@pytest.mark.asyncio
async def test_stdio_cannot_impersonate_matrix_owner(tmp_path):
    bootstrap = (
        "import sys; from unittest.mock import MagicMock; "
        "sys.modules.update({name: MagicMock() for name in "
        "('vnstock', 'vnstock_pipeline', 'vnstock_data', 'vnstock_ta', 'vnstock_news')}); "
        "from vnibb.mcp.server import main; main()"
    )
    api_root = Path(__file__).resolve().parents[2]
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-c", bootstrap, "--transport", "stdio"],
        cwd=str(tmp_path),
        env={
            "PYTHONPATH": str(api_root),
            "ENVIRONMENT": "test",
            "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
            "REDIS_URL": "",
            "REDIS_HOST": "",
            "REDIS_PORT": "0",
            "DATA_BACKEND": "postgres",
            "MONGODB_ENABLED": "false",
            "VNSTOCK_RUNTIME_INSTALL": "0",
            "SUPABASE_JWT_SECRET": JWT_SECRET,
            "VNIBB_MCP_SHARED_BEARER_TOKEN": "deployment-shared",
            "AUTHORIZATION": f"Bearer {signed_token()}",
            "USER_ID": OWNER,
        },
    )
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=20)) as session:
            await session.initialize()
            tools = await session.list_tools()
            tool = next(tool for tool in tools.tools if tool.name == "get_matrix_selection")
            assert set(tool.inputSchema["properties"]) == {"snapshot_id", "result_ids"}
            assert tool.annotations.readOnlyHint is True
            args = {"snapshot_id": "00000000-0000-0000-0000-000000000099", "result_ids": ["result"]}
            assert "verified user JWT" in error_text(await session.call_tool("get_matrix_selection", args))
            impersonation = {**args, "user_id": OWNER, "token": signed_token()}
            assert (await session.call_tool("get_matrix_selection", impersonation)).isError
