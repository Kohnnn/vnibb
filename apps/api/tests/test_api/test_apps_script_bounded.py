import pytest
from vnibb.api.v1.schemas import MetaData, StandardResponse
from vnibb.core.config import settings
from vnibb.providers.vnstock.financials import FinancialStatementData

KEY = 'test-apps-script-key'
HEADERS = {'X-API-Key': KEY}


@pytest.fixture(autouse=True)
def configured_key(monkeypatch):
    monkeypatch.setattr(settings, 'apps_script_api_key', KEY)


@pytest.mark.asyncio
@pytest.mark.parametrize('headers,status', [({}, 422), ({'X-API-Key': 'wrong'}, 401)])
async def test_auth(client, headers, status):
    response = await client.get('/api/v1/apps-script/bounded/listing', headers=headers)
    assert response.status_code == status


@pytest.mark.asyncio
async def test_unconfigured(client, monkeypatch):
    monkeypatch.setattr(settings, 'apps_script_api_key', None)
    response = await client.get('/api/v1/apps-script/bounded/listing', headers=HEADERS)
    assert response.status_code == 503


@pytest.mark.asyncio
@pytest.mark.parametrize('query', [
    'historical?symbol=VNM',
    'historical?symbol=VNM&start_date=2000-01-01&end_date=2026-01-01',
    'historical?symbol=VNM&start_date=2026-02-01&end_date=2026-01-01',
    'listing?limit=2001',
    'financials?symbol=VNM&limit=21',
    'financials?limit=5',
])
async def test_bounds(client, query):
    response = await client.get('/api/v1/apps-script/bounded/' + query, headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_legacy_array(client, monkeypatch):
    async def fetch(params):
        return [FinancialStatementData(symbol='VNM', period='2025', statement_type='income', revenue=123)]
    monkeypatch.setattr('vnibb.api.v1.apps_script.VnstockFinancialsFetcher.fetch', fetch)
    response = await client.get('/api/v1/apps-script/financials/VNM?limit=5', headers=HEADERS)
    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert response.json()[0]['revenue'] == 123


@pytest.mark.asyncio
async def test_financials_serving_unknown_date_and_limit(client, monkeypatch):
    calls = []
    async def serve(**kwargs):
        calls.append(kwargs)
        return StandardResponse(data=[{'symbol': 'VNM', 'period': str(year), 'updated_at': '2026-09-01'} for year in range(2020, 2025)])
    monkeypatch.setattr('vnibb.api.v1.equity.get_financials', serve)
    response = await client.get('/api/v1/apps-script/bounded/financials?symbol=VNM&limit=2', headers=HEADERS)
    body = response.json()
    assert len(body['data']) == body['meta']['count'] == 2
    assert calls[0]['limit'] == 2
    assert body['meta']['source'] is None
    assert body['meta']['source_date'] is None
    assert body['meta']['undated_row_count'] == 2
    assert body['meta']['retrieved_at']
    assert body['meta']['limitations']


@pytest.mark.asyncio
@pytest.mark.parametrize('error,state', [(None, 'empty'), ('offline', 'unavailable')])
async def test_empty_vs_unavailable(client, monkeypatch, error, state):
    async def serve(**kwargs):
        return StandardResponse(data=[], error=error, meta=MetaData(count=0))
    monkeypatch.setattr('vnibb.api.v1.screener.get_screener', serve)
    response = await client.get('/api/v1/apps-script/bounded/screener', headers=HEADERS)
    assert response.json()['meta']['availability'] == state
    assert response.json()['error'] == error


@pytest.mark.asyncio
async def test_actual_fallback_and_mixed_dates(client, monkeypatch):
    async def serve(**kwargs):
        return StandardResponse(data=[
            {'symbol': 'VNM', 'trade_date': '2025-06-30'},
            {'symbol': 'FPT', 'trade_date': '2025-07-15'},
            {'symbol': 'TCB', 'updated_at': '2026-09-01'},
        ], meta=MetaData(count=3, source='fallback_cache', fallback=True, stale=True))
    monkeypatch.setattr('vnibb.api.v1.screener.get_screener', serve)
    response = await client.get('/api/v1/apps-script/bounded/screener?source=VCI', headers=HEADERS)
    meta = response.json()['meta']
    assert meta['source'] == 'fallback_cache'
    assert meta['source_date'] == '2025-07-15'
    assert meta['undated_row_count'] == 1
    assert 'not whole-dataset freshness' in meta['source_date_basis']
    assert meta['serving_meta']['fallback'] is True
    assert meta['serving_meta']['stale'] is True


@pytest.mark.asyncio
async def test_historical_retains_serving_provenance(client, monkeypatch):
    async def serve(**kwargs):
        return StandardResponse(data=[{'time': '2025-01-02'}, {'time': '2025-01-03'}], meta=MetaData(count=2, source_mode='merged', source_counts={'mongo': 1, 'db': 1}, warnings=['boundary gap'], unit_status='unconfirmed'))
    monkeypatch.setattr('vnibb.api.v1.equity.get_historical_prices', serve)
    response = await client.get('/api/v1/apps-script/bounded/historical?symbol=VNM&start_date=2025-01-01&end_date=2025-01-31&limit=1', headers=HEADERS)
    body = response.json()
    assert len(body['data']) == 1
    assert body['meta']['source_date'] == '2025-01-02'
    assert body['meta']['source'] == 'merged'
    assert body['meta']['serving_meta']['source_counts'] == {'mongo': 1, 'db': 1}
    assert 'boundary gap' in body['meta']['limitations']


@pytest.mark.asyncio
async def test_listing_projection_no_date(client, monkeypatch):
    async def serve(**kwargs):
        return StandardResponse(data=[{'symbol': 'VNM', 'organ_name': 'Dairy', 'trade_date': '2025-01-01'}], meta=MetaData(count=1, source='cache'))
    monkeypatch.setattr('vnibb.api.v1.screener.get_screener', serve)
    response = await client.get('/api/v1/apps-script/bounded/listing', headers=HEADERS)
    body = response.json()
    assert body['data'][0]['company_name'] == 'Dairy'
    assert body['meta']['source_date'] is None


@pytest.mark.asyncio
async def test_index_persistence_timestamp_not_source_date(client, monkeypatch):
    async def serve(**kwargs):
        return {'data': [{'symbol': 'VNINDEX', 'updated_at': '2026-09-01'}], 'source': 'db', 'error': None}
    monkeypatch.setattr('vnibb.api.v1.market.get_market_indices', serve)
    response = await client.get('/api/v1/apps-script/bounded/market_indices', headers=HEADERS)
    assert response.json()['meta']['source_date'] is None
    assert response.json()['meta']['source'] == 'db'


@pytest.mark.asyncio
async def test_partial_rows_not_discarded(client, monkeypatch):
    async def serve(**kwargs):
        return StandardResponse(data=[{'symbol': 'VNM'}], error='partial failure')
    monkeypatch.setattr('vnibb.api.v1.screener.get_screener', serve)
    response = await client.get('/api/v1/apps-script/bounded/screener', headers=HEADERS)
    assert response.json()['meta']['availability'] == 'partial'
    assert len(response.json()['data']) == 1
