from datetime import datetime
from types import SimpleNamespace

import pytest

import vnibb.services.data_pipeline as module
from vnibb.providers.vnstock.financials import FinancialStatementData, VnstockFinancialsFetcher
from vnibb.services.data_pipeline import DataPipeline


@pytest.fixture
def acquisition(monkeypatch):
    attempts, rows, receipts, queries = [], [], [], []
    state = SimpleNamespace(failure=None, conflict=None, cache_failure=False, periods=None,
                            empty=None, system_exit=None, failure_by_symbol=None, source='VCI')
    pipeline = DataPipeline()

    class Result:
        def __init__(self, ids=(1,)):
            self.ids = ids

        def scalars(self):
            return self

        def all(self):
            return list(self.ids)

    class Upsert:
        def __init__(self, values):
            self.values = values

        def returning(self, *columns):
            return self

    class Session:
        async def __aenter__(self):
            self.pending = []
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, statement):
            if isinstance(statement, Upsert):
                if state.conflict == statement.values['period']:
                    return Result(())
                self.pending.append(statement.values)
                return Result()
            values = statement.compile().params
            self.pending.append(('receipt', values))
            return Result()

        async def commit(self):
            for value in self.pending:
                if isinstance(value, tuple):
                    receipts.append(value[1])
                else:
                    rows.append(value)
            self.pending.clear()

    async def wait(bucket):
        pass

    async def cache(*args):
        if state.cache_failure:
            raise RuntimeError('cache unavailable')

    async def extract(query):
        kind = query['statement_type']
        attempts.append(kind)
        queries.append(query)
        if state.system_exit == kind:
            raise SystemExit(f'{kind} aborted')
        if state.empty == kind:
            return []
        if state.failure == kind:
            raise RuntimeError(f'{kind} unavailable')
        periods = state.periods or [str(datetime.utcnow().year - 1)]
        if state.failure_by_symbol == query['symbol']:
            raise RuntimeError(f'{kind} unavailable for {query["symbol"]}')
        metric = {'income': 'revenue', 'balance': 'total_assets', 'cashflow': 'operating_cash_flow'}[kind]
        return [FinancialStatementData(symbol=query['symbol'], statement_type=kind, period=period,
                    source=state.source, currency='VND', value_unit='VND',
                    consolidation_basis='consolidated',
                    flow_basis='single_quarter' if query['period'] == 'quarter' else 'annual',
                    unit_metadata={metric: {'source_unit': 'VND', 'value_unit': 'VND'}},
                    raw_data={'provider_value': 123}, **{metric: 123}).model_dump(mode='json')
                for period in periods]

    monkeypatch.setattr(module, 'async_session_maker', Session)
    monkeypatch.setattr(module, 'get_upsert_stmt', lambda model, keys, values, **kwargs: Upsert(values))
    monkeypatch.setattr(pipeline, '_wait_for_rate_limit', wait)
    monkeypatch.setattr(pipeline, '_cache_set_json', cache)
    monkeypatch.setattr(VnstockFinancialsFetcher, 'extract_data', extract)
    return pipeline, state, attempts, rows, receipts, queries


@pytest.mark.asyncio
@pytest.mark.parametrize('failed', ['income', 'balance'])
async def test_independent_failure_retains_other_statement_commits(acquisition, failed):
    pipeline, state, attempts, rows, receipts, _ = acquisition
    state.failure = failed
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=1, progress=progress) == 0
    assert attempts == ['income', 'balance', 'cashflow']
    assert len(rows) == 2
    assert progress['stage_stats']['financials']['persisted_rows'] == 2
    assert progress['stage_stats']['financials']['partial'] == 1
    assert progress['financial_acquisition']['complete'] is False
    outcomes = progress['financial_acquisition']['outcomes']['VNM']
    assert outcomes[failed]['status'] == 'failed'
    assert all(outcomes[kind]['status'] == 'completed' for kind in attempts if kind != failed)
    terminal = [r for r in receipts if r['sync_type'] == 'financial_acquisition'
                and r['status'] != 'running']
    assert len(terminal) == 3
    assert all(r['additional_data']['cycle_id'] for r in receipts)


@pytest.mark.asyncio
async def test_gap_is_durable_and_not_row_count_completeness(acquisition):
    pipeline, state, _, rows, receipts, _ = acquisition
    year = datetime.utcnow().year - 1
    state.periods = [str(year), str(year - 2), str(year - 2)]
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=3, progress=progress) == 0
    outcome = progress['financial_acquisition']['outcomes']['VNM']['income']
    assert outcome['expected_periods'] == [str(year - offset) for offset in range(3)]
    assert outcome['period_outcomes'][str(year - 1)]['status'] == 'missing'
    assert outcome['period_outcomes'][str(year)]['status'] == 'stored'
    assert outcome['period_outcomes'][str(year - 2)]['unavailable_reason'] == 'duplicate_statement_period'
    assert outcome['source_returned_period_count'] == 2
    assert outcome['complete'] is False
    assert receipts[-1]['additional_data']['complete'] is False


@pytest.mark.asyncio
async def test_withheld_period_does_not_block_other_verified_periods_or_replace_cache(acquisition, monkeypatch):
    pipeline, _, _, rows, receipts, _ = acquisition
    year = datetime.utcnow().year - 1
    cache = []

    async def extract(query):
        return [FinancialStatementData(
            symbol=query['symbol'], statement_type='income', period=str(period), source='VCI',
            currency='VND', value_unit='VND', consolidation_basis='consolidated' if verified else None,
            flow_basis='annual', revenue=100,
            unit_metadata={'revenue': {'source_unit': 'VND', 'value_unit': 'VND'}},
        ).model_dump(mode='json') for period, verified in ((year, True), (year - 1, False))]

    async def record_cache(*args):
        cache.append(args)

    monkeypatch.setattr(VnstockFinancialsFetcher, 'extract_data', extract)
    monkeypatch.setattr(pipeline, '_cache_set_json', record_cache)
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=2, statement_types=['income'],
                                          progress=progress) == 0
    outcome = progress['financial_acquisition']['outcomes']['VNM']['income']
    assert outcome['persisted_rows'] == 1
    assert outcome['status'] == 'partial' and not outcome['complete']
    assert outcome['period_outcomes'][str(year)]['status'] == 'stored'
    withheld = outcome['period_outcomes'][str(year - 1)]
    assert withheld['status'] == 'withheld'
    assert withheld['rejected_metrics']['revenue'] == 'unverified_statement_basis'
    assert outcome['source_shortfall'] is False
    assert len(rows) == 1 and rows[0]['revenue'] == 100
    assert cache == []
    assert receipts[-2]['additional_data'] == outcome


@pytest.mark.asyncio
async def test_explicit_full_history_exceeds_default_caps(acquisition):
    pipeline, state, _, _, _, queries = acquisition
    year = datetime.utcnow().year - 1
    state.periods = [str(y) for y in range(year, year - 12, -1)]
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], start_year=year - 11,
                                          progress=progress) == 1
    assert all(query['limit'] >= 12 for query in queries)
    assert progress['financial_acquisition']['complete'] is True


@pytest.mark.asyncio
async def test_cache_failure_reports_committed_rows_without_skipping(acquisition):
    pipeline, state, attempts, rows, receipts, _ = acquisition
    state.cache_failure = True
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=1, progress=progress) == 0
    assert attempts == ['income', 'balance', 'cashflow']
    assert len(rows) == 3
    assert progress['stage_stats']['financials']['persisted_rows'] == 3
    outcome = progress['financial_acquisition']['outcomes']['VNM']['income']
    assert outcome['period_outcomes'][str(datetime.utcnow().year - 1)]['status'] == 'stored'
    assert outcome['complete'] is False
    assert 'cache unavailable' in outcome['error']
    assert receipts[-1]['status'] == 'partial'


@pytest.mark.asyncio
async def test_retained_source_conflict_is_not_acquired(acquisition):
    pipeline, state, attempts, rows, _, _ = acquisition
    state.conflict = str(datetime.utcnow().year - 1)
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=1, progress=progress) == 0
    assert attempts == ['income', 'balance', 'cashflow']
    assert rows == []
    assert progress['stage_stats']['financials']['persisted_rows'] == 0
    outcome = progress['financial_acquisition']['outcomes']['VNM']['income']
    assert outcome['period_outcomes'][state.conflict]['status'] == 'retained_source_conflict'


@pytest.mark.asyncio
async def test_issuer_observation_is_not_persisted_by_financial_acquisition(acquisition):
    pipeline, state, _, rows, _, _ = acquisition
    state.source = 'issuer_report'
    progress = {}
    assert await pipeline.sync_financials(symbols=['FPT'], count=1, progress=progress) == 0
    assert rows == []
    outcomes = progress['financial_acquisition']['outcomes']['FPT']
    assert all(outcome['status'] == 'failed' for outcome in outcomes.values())
    assert all('issuer_report persistence is not enabled' in outcome['error'] for outcome in outcomes.values())


@pytest.mark.asyncio
async def test_quarterly_history_has_no_forty_period_cap(acquisition):
    pipeline, state, _, _, _, queries = acquisition
    now = datetime.utcnow()
    latest = now.year * 4 + (now.month - 1) // 3 - 1
    state.periods = [f'Q{index % 4 + 1}-{index // 4}'
                     for index in range(latest, latest - 48, -1)]
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], period='quarter', count=48,
                                          progress=progress) == 1
    assert all(query['limit'] == 48 for query in queries)
    assert progress['financial_acquisition']['expected_periods'] == state.periods


@pytest.mark.asyncio
async def test_actual_short_source_does_not_certify_requested_full_history(acquisition):
    pipeline, _, _, rows, _, queries = acquisition
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], start_year=2000,
                                          progress=progress) == 0
    outcome = progress['financial_acquisition']['outcomes']['VNM']['income']
    assert queries[0]['limit'] == datetime.utcnow().year - 2000 + 1
    assert len(rows) == 3
    assert outcome['source_returned_period_count'] == 1
    assert outcome['source_shortfall'] is True
    assert outcome['source_exhausted'] is None
    assert outcome['period_outcomes']['2000']['status'] == 'missing'


@pytest.mark.asyncio
@pytest.mark.parametrize('kwargs', [{'count': 0}, {'count': True}, {'start_year': 1899},
                                    {'start_year': 2000, 'count': 10}])
async def test_invalid_history_window_rejects_before_provider_calls(acquisition, kwargs):
    pipeline, _, attempts, _, _, _ = acquisition
    with pytest.raises(ValueError):
        await pipeline.sync_financials(symbols=['VNM'], **kwargs)
    assert attempts == []


@pytest.mark.asyncio
async def test_extractor_passes_requested_count_to_supported_provider(monkeypatch):
    import pandas as pd

    from vnibb.providers.vnstock import runtime
    from vnibb.providers.vnstock.financials import FinancialsQueryParams

    counts = []

    class Finance:
        def income_statement(self, count=6):
            counts.append(count)
            return pd.DataFrame([{'period': '2025', 'revenue': 10}])

    async def execute(operation, timeout):
        return operation()

    monkeypatch.setattr(runtime, 'create_finance', lambda *args: Finance())
    monkeypatch.setattr(runtime, 'validate_source', lambda value: 'VCI')
    monkeypatch.setattr(runtime, 'run_financial_provider', execute)
    params = FinancialsQueryParams(symbol='VNM', limit=108)
    await VnstockFinancialsFetcher.extract_data(VnstockFinancialsFetcher.transform_query(params))
    assert counts == [108]


@pytest.mark.asyncio
@pytest.mark.parametrize('failure_mode', ['empty', 'system_exit'])
async def test_empty_or_aborted_statement_does_not_skip_other_statements(acquisition, failure_mode):
    pipeline, state, attempts, rows, _, _ = acquisition
    setattr(state, failure_mode, 'income')
    progress = {}
    assert await pipeline.sync_financials(symbols=['VNM'], count=1, progress=progress) == 0
    assert attempts == ['income', 'balance', 'cashflow']
    assert len(rows) == 2
    assert progress['financial_acquisition']['outcomes']['VNM']['income']['status'] == 'failed'


@pytest.mark.asyncio
async def test_resumed_cycle_completeness_counts_whole_cycle_not_suffix(acquisition):
    pipeline, state, _, _, receipts, _ = acquisition
    def cycle_receipts():
        return [r['additional_data'] for r in receipts
                if r['sync_type'] == 'financial_cycle']
    progress = {}
    await pipeline.sync_financials(symbols=['AAA', 'BBB'], count=1, progress=progress)
    assert progress['financial_acquisition']['complete'] is True
    assert progress['financial_acquisition']['expected_symbol_count'] == 2
    assert progress['financial_acquisition']['attempted_symbols'] == ['AAA', 'BBB']
    assert cycle_receipts()[-1]['status'] == 'completed'
    assert cycle_receipts()[-1]['cycle_outcome'] == 'completed'

    # Resume the checkpointed cycle: AAA already admitted, BBB re-fails.
    progress['last_symbol'] = 'AAA'
    state.failure_by_symbol = 'BBB'
    await pipeline.sync_financials(symbols=['AAA', 'BBB'], count=1, progress=progress)
    resumed = progress['financial_acquisition']
    assert resumed['attempted_symbols'] == ['BBB']
    assert resumed['expected_symbol_count'] == 2
    assert resumed['complete'] is False
    assert resumed['cycle_outcome'] == 'incomplete'
    assert resumed['symbol_statuses']['AAA'] == ['completed']
    assert resumed['symbol_statuses']['BBB'] == ['failed']
    assert cycle_receipts()[-1]['status'] == 'partial'

    # Caller re-presents the cycle with the checkpoint rewound to the last admitted symbol;
    # BBB now succeeds and the cycle certifies both without re-acquiring AAA.
    progress['last_symbol'] = 'AAA'
    state.failure_by_symbol = None
    await pipeline.sync_financials(symbols=['AAA', 'BBB'], count=1, progress=progress)
    assert cycle_receipts()[-1]['complete'] is True
    assert cycle_receipts()[-1]['cycle_outcome'] == 'completed'
    assert cycle_receipts()[-1]['status'] == 'completed'
    assert cycle_receipts()[-1]['attempted_symbols'] == ['BBB']
    assert cycle_receipts()[-1]['symbol_statuses']['AAA'] == ['completed']
