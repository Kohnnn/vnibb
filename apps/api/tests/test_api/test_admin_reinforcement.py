import pytest


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
