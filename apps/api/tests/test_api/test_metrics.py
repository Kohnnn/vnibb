import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from vnibb.middleware import metrics as metrics_module
from vnibb.middleware.metrics import MetricsMiddleware, ProcessMetrics


def test_process_metrics_render_prometheus_histogram() -> None:
    registry = ProcessMetrics()
    registry.request_started()
    registry.request_finished("GET", "/api/v1/equity/{symbol}/quote", 200, 0.25)

    output = registry.render()

    assert "vnibb_http_active_requests 0" in output
    assert (
        'vnibb_http_requests_total{method="GET",route="/api/v1/equity/{symbol}/quote",status="200"} 1'
        in output
    )
    assert (
        'vnibb_http_request_duration_seconds_bucket{method="GET",route="/api/v1/equity/{symbol}/quote",le="0.1"} 0'
        in output
    )
    assert (
        'vnibb_http_request_duration_seconds_bucket{method="GET",route="/api/v1/equity/{symbol}/quote",le="0.25"} 1'
        in output
    )
    assert (
        'vnibb_http_request_duration_seconds_count{method="GET",route="/api/v1/equity/{symbol}/quote"} 1'
        in output
    )


def test_process_metrics_renders_bounded_cache_outcomes() -> None:
    registry = ProcessMetrics()

    registry.cache_outcome("quote", "hit")
    registry.cache_outcome("raw:VNM", "miss")
    registry.cache_outcome("quote", "invalid")

    output = registry.render()

    assert 'vnibb_cache_outcomes_total{key_prefix="quote",outcome="hit"} 1' in output
    assert 'vnibb_cache_outcomes_total{key_prefix="__unknown__",outcome="miss"} 1' in output
    assert "raw:VNM" not in output
    assert "invalid" not in output


def test_process_metrics_bounds_route_labels() -> None:
    registry = ProcessMetrics()
    registry.MAX_ROUTES = 1

    registry.request_finished("GET", "/one", 200, 0.01)
    registry.request_finished("GET", "/two", 200, 0.01)

    output = registry.render()

    assert 'route="/one"' in output
    assert 'route="__overflow__"' in output
    assert 'route="/two"' not in output


@pytest.mark.asyncio
async def test_metrics_middleware_uses_route_template(monkeypatch) -> None:
    registry = ProcessMetrics()
    monkeypatch.setattr(metrics_module, "metrics_registry", registry)
    app = FastAPI()
    app.add_middleware(MetricsMiddleware)

    @app.get("/items/{item_id}")
    async def item(item_id: str):
        return {"item_id": item_id}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/items/secret-value")

    assert response.status_code == 200
    assert float(response.headers["X-Response-Time"].removesuffix("ms")) >= 0
    output = registry.render()
    assert 'route="/items/{item_id}"' in output
    assert "secret-value" not in output


@pytest.mark.asyncio
async def test_metrics_endpoint_reports_template_route_and_timing(client) -> None:
    live_response = await client.get("/live")
    metrics_response = await client.get("/metrics")

    assert live_response.status_code == 200
    assert float(live_response.headers["X-Response-Time"].removesuffix("ms")) >= 0
    assert metrics_response.status_code == 200
    assert metrics_response.headers["content-type"].startswith("text/plain; version=0.0.4")
    assert (
        'vnibb_http_requests_total{method="GET",route="/live",status="200"} '
        in metrics_response.text
    )
