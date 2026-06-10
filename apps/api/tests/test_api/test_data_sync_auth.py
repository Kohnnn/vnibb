"""Regression tests: data-sync and admin endpoints must be auth-gated."""

import pytest


@pytest.mark.asyncio
async def test_data_sync_seed_rejects_missing_admin_key(client):
    response = await client.post(
        "/api/v1/data/seed/stocks",
        headers={"X-Admin-Key": ""},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_data_sync_seed_rejects_wrong_admin_key(client):
    response = await client.post(
        "/api/v1/data/seed/stocks",
        headers={"X-Admin-Key": "wrong-key"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_data_sync_health_rejects_missing_admin_key(client):
    response = await client.get(
        "/api/v1/data/health",
        headers={"X-Admin-Key": ""},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_database_query_rejects_missing_admin_key(client):
    response = await client.post(
        "/api/v1/admin/database/query",
        json={"query": "SELECT 1"},
        headers={"X-Admin-Key": ""},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_seed_rejects_missing_admin_key(client):
    response = await client.post(
        "/api/v1/admin/database/seed/stocks",
        headers={"X-Admin-Key": ""},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_accepts_configured_key(client):
    # Default client fixture sends the configured test key.
    response = await client.get("/api/v1/admin/sync-status")
    assert response.status_code != 401
