import pytest


@pytest.mark.asyncio
async def test_published_system_layouts_is_edge_cacheable(client, monkeypatch):
    async def fake_list_published_templates():
        return []

    monkeypatch.setattr(
        "vnibb.api.v1.dashboard.system_layout_template_service.list_published_templates",
        fake_list_published_templates,
    )

    response = await client.get("/api/v1/dashboard/system-layouts/published")

    assert response.status_code == 200
    cache_control = response.headers.get("Cache-Control")
    assert cache_control is not None
    assert "public" in cache_control
    assert "max-age=300" in cache_control


@pytest.mark.asyncio
async def test_owned_dashboard_route_is_not_edge_cached(client):
    response = await client.get("/api/v1/dashboard/999999")

    assert response.headers.get("Cache-Control") in (None, "no-store, max-age=0")
