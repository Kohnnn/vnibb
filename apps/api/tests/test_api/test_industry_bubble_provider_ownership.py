import asyncio
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from vnibb.api.v1 import market


@pytest.fixture
def bubble_inputs(monkeypatch):
    retained_rows = []
    monkeypatch.setattr(market, "_market_provider_jobs", {})

    async def screener_cache(*_args, **_kwargs):
        return SimpleNamespace(data=retained_rows, hit=bool(retained_rows))

    async def empty_rows(**_kwargs):
        return []

    async def empty_map(*_args):
        return {}

    monkeypatch.setattr(market.CacheManager, "get_screener_data", screener_cache)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", empty_rows)
    monkeypatch.setattr(market, "_load_stock_metadata", empty_map)
    monkeypatch.setattr(market, "_load_change_pct_map", empty_map)
    monkeypatch.setattr(market, "_load_latest_ratio_metrics", empty_map)
    monkeypatch.setattr(market, "_load_latest_income_revenue", empty_map)
    return retained_rows


@pytest.mark.asyncio
async def test_industry_bubble_retains_provider_across_axes_cancellation_deadlines_and_retry(
    client, monkeypatch, bubble_inputs,
):
    work = asyncio.get_running_loop().create_future()
    started = asyncio.Event()
    completed = asyncio.Event()
    submissions = []
    cancellations = 0
    completions = 0

    async def slow_provider(params):
        nonlocal cancellations, completions
        submissions.append(params.model_dump())
        started.set()
        try:
            rows = await asyncio.shield(work)
            completions += 1
            completed.set()
            return rows
        except asyncio.CancelledError:
            cancellations += 1
            raise

    monkeypatch.setattr(market, "HEATMAP_FETCH_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", slow_provider)
    url = "/api/v1/market/industry-bubble?symbol=FPT"
    cancelled = asyncio.create_task(client.get(url))
    requests = []
    try:
        async with asyncio.timeout(1):
            await started.wait()
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            requests = [asyncio.create_task(client.get(
                f"{url}&x_metric={x}&y_metric={y}&size_metric={size}&top_n={top_n}"
            )) for x, y, size, top_n in [
                ("pb_ratio", "pe_ratio", "market_cap", 5),
                ("pe_ratio", "pb_ratio", "market_cap", 20),
                ("roe", "roa", "volume", 10),
                ("revenue_growth", "earnings_growth", "revenue", 50),
            ]]
            responses = await asyncio.gather(*requests)
            retry = await client.get(url)
        observed = {
            "statuses": [response.status_code for response in [*responses, retry]],
            "provider_submissions": len(submissions),
            "provider_cancellations": cancellations,
            "owned_jobs_before_completion": len(market._market_provider_jobs),
        }
        print(f"bubble ownership before completion: {observed}")
        assert observed == {
            "statuses": [503] * 5,
            "provider_submissions": 1,
            "provider_cancellations": 0,
            "owned_jobs_before_completion": 1,
        }
        for response in [*responses, retry]:
            assert "timed out" in response.json()["message"].lower()
        work.set_result([])
        async with asyncio.timeout(1):
            await completed.wait()
            while market._market_provider_jobs:
                await asyncio.sleep(0)
        print(f"bubble ownership after completion: completions={completions}, owned_jobs=0")
        assert completions == 1
    finally:
        if not work.done():
            work.set_result([])
        await asyncio.gather(cancelled, *requests, return_exceptions=True)
        await asyncio.sleep(0)
        await asyncio.sleep(0)


@pytest.mark.asyncio
@pytest.mark.parametrize("rows,status,reason", [
    ([], 503, "Industry bubble screener data unavailable"),
    ([{"symbol": "SSI"}], 404, "Reference symbol FPT not found"),
])
async def test_industry_bubble_fetches_identical_params_once_when_answered(
    client, monkeypatch, bubble_inputs, rows, status, reason,
):
    calls = 0

    async def provider(_params):
        nonlocal calls
        calls += 1
        return rows

    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", provider)
    response = await client.get("/api/v1/market/industry-bubble?symbol=FPT")
    assert response.status_code == status
    assert response.json()["message"] == reason
    assert calls == 1


@pytest.mark.asyncio
async def test_industry_bubble_provider_failure_has_specific_unavailable_reason(
    client, monkeypatch, bubble_inputs,
):
    async def unavailable(_params):
        raise market.ProviderError(message="Screener supplier is unavailable", provider="vnstock")

    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", unavailable)
    response = await client.get("/api/v1/market/industry-bubble?symbol=FPT")
    assert response.status_code == 503
    assert response.json()["message"] == "Screener supplier is unavailable"


@pytest.mark.asyncio
async def test_industry_bubble_cache_lookup_obeys_existing_route_deadline(client, monkeypatch):
    async def slow_cache(*_args, **_kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(market, "MARKET_ROUTE_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(market.CacheManager, "get_screener_data", slow_cache)
    async with asyncio.timeout(1):
        response = await client.get("/api/v1/market/industry-bubble?symbol=FPT")
    assert response.status_code == 503
    assert response.json()["message"] == "Market data deadline exceeded"


@pytest.mark.asyncio
async def test_industry_bubble_retained_points_do_not_wait_for_owned_provider(
    client, monkeypatch, bubble_inputs,
):
    release = asyncio.Event()
    started = asyncio.Event()
    calls = 0

    async def provider(_params):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return []

    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", provider)
    monkeypatch.setattr(market, "HEATMAP_FETCH_TIMEOUT_SECONDS", 0.02)
    pending = asyncio.create_task(client.get("/api/v1/market/industry-bubble?symbol=FPT"))
    try:
        async with asyncio.timeout(1):
            await started.wait()
            timed_out = await pending
            assert timed_out.status_code == 503
            bubble_inputs.extend([
                {"symbol": "FPT", "industry": "technology", "market_cap": 100.0},
                {"symbol": "CMG", "industry": "technology", "market_cap": 200.0},
            ])

            async def ratios(_symbols):
                return {"FPT": {"pb_ratio": 2.0, "pe_ratio": 20.0},
                        "CMG": {"pb_ratio": 4.0, "pe_ratio": 40.0}}

            monkeypatch.setattr(market, "_load_latest_ratio_metrics", ratios)
            response = await client.get("/api/v1/market/industry-bubble?symbol=FPT")
        assert response.status_code == 200
        assert response.json()["sector_average"] == {"x": 3.0, "y": 30.0}
        assert response.json()["updated_at"] is None
        assert {point["symbol"] for point in response.json()["data"]} == {"FPT", "CMG"}
        assert calls == 1
        assert len(market._market_provider_jobs) == 1
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        async with asyncio.timeout(1):
            while market._market_provider_jobs:
                await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_industry_bubble_reference_refresh_preserves_useful_retained_peer_values(
    client, monkeypatch, bubble_inputs,
):
    bubble_inputs.append({
        "symbol": "CMG", "industry": "technology", "market_cap": 200.0,
        "snapshot_date": "2026-10-23",
    })

    async def provider(_params):
        return [
            {"symbol": "FPT", "industry": "technology", "market_cap": 100.0},
            {"symbol": "CMG", "industry": "technology", "market_cap": None},
        ]

    async def ratios(_symbols):
        return {"FPT": {"pb_ratio": 2.0, "pe_ratio": 20.0},
                "CMG": {"pb_ratio": 4.0, "pe_ratio": 40.0}}

    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", provider)
    monkeypatch.setattr(market, "_load_latest_ratio_metrics", ratios)
    response = await client.get("/api/v1/market/industry-bubble?symbol=FPT")
    assert response.status_code == 200
    assert {point["symbol"]: point["size"] for point in response.json()["data"]} == {
        "FPT": 100.0, "CMG": 200.0,
    }
    assert response.json()["sector_average"] == {"x": 3.0, "y": 30.0}
    assert datetime.fromisoformat(response.json()["updated_at"]).date() == date(2026, 10, 23)
