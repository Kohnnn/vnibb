import pytest
from httpx import ASGITransport, AsyncClient

from vnibb.api.main import app


@pytest.fixture
def unauth_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


UNAUTH_ROUTES = [
    ("GET", "/api/v1/admin/database/tables"),
    ("GET", "/api/v1/admin/database/freshness-summary"),
    ("GET", "/api/v1/admin/data-health"),
    ("GET", "/api/v1/admin/database/table/stocks/schema"),
    ("GET", "/api/v1/admin/database/table/stocks/sample"),
    ("GET", "/api/v1/admin/sync-status"),
    ("GET", "/api/v1/admin/database/stats"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", UNAUTH_ROUTES)
async def test_admin_routes_reject_unauthorized(method, path, unauth_client):
    response = await unauth_client.request(method, path)
    assert response.status_code == 401, f"{method} {path} should return 401, got {response.status_code}"


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", UNAUTH_ROUTES)
async def test_admin_routes_accept_authorized(method, path, client):
    response = await client.request(method, path)
    assert response.status_code not in (401, 403), f"{method} {path} returned {response.status_code} with valid key"


PUBLIC_ROUTES = [
    ("GET", "/api/v1/admin/ai-runtime/public"),
    ("GET", "/api/v1/admin/unit-runtime/public"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PUBLIC_ROUTES)
async def test_public_admin_routes_accessible_without_auth(method, path, unauth_client):
    response = await unauth_client.request(method, path)
    assert response.status_code != 401, f"Public route {path} should not require auth"
    assert response.status_code != 403, f"Public route {path} should not require auth"


@pytest.mark.asyncio
async def test_admin_reinforce_dry_run_with_explicit_symbols(client):
    response = await client.post(
        "/api/v1/admin/reinforce",
        json={
            "symbols": ["vnm", "fpt", "VNM"],
            "domains": ["prices", "ratios"],
            "dry_run": True,
            "max_symbols": 10,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["dry_run"] is True
    assert payload["selection_mode"] == "explicit"
    assert payload["domains"] == ["prices", "ratios"]
    assert payload["symbols_count"] == 2
    assert payload["symbols_preview"] == ["FPT", "VNM"]
    assert payload["jobs_scheduled"] == 0
    assert payload["estimated_requests"] == 12
    assert payload["jobs"][0]["job"] == "run_reinforcement"


@pytest.mark.asyncio
async def test_admin_reinforce_rejects_invalid_domain(client):
    response = await client.post(
        "/api/v1/admin/reinforce",
        json={
            "symbols": ["VNM"],
            "domains": ["prices", "invalid_domain"],
            "dry_run": True,
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["message"] == "Unsupported domains requested"
    assert payload["invalid_domains"] == ["invalid_domain"]


@pytest.mark.asyncio
async def test_admin_reinforce_stale_mode_schedules_background_job(client, monkeypatch):
    async def fake_collect_reinforcement_candidates(_db, limit: int):
        assert limit == 5
        return ["VCB", "HPG"]

    calls = {}

    async def fake_run_reinforcement(*, symbols, domains):
        calls["symbols"] = symbols
        calls["domains"] = domains
        return {"status": "completed"}

    monkeypatch.setattr(
        "vnibb.api.v1.admin._collect_reinforcement_candidates",
        fake_collect_reinforcement_candidates,
    )
    monkeypatch.setattr(
        "vnibb.services.data_pipeline.data_pipeline.run_reinforcement",
        fake_run_reinforcement,
    )

    response = await client.post(
        "/api/v1/admin/data-health/reinforce",
        json={
            "symbols": ["STALE"],
            "domains": ["shareholders"],
            "dry_run": False,
            "max_symbols": 1,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selection_mode"] == "stale"
    assert payload["symbols_preview"] == ["VCB", "HPG"]
    assert payload["domains"] == ["shareholders"]
    assert payload["jobs_scheduled"] == 1
    assert calls["symbols"] == ["VCB", "HPG"]
    assert calls["domains"] == ["shareholders"]
