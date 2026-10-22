import { fireEvent, render, screen, within } from '@testing-library/react';
import { useForeignTrading, useInsiderSentiment, useShareholders } from '@/lib/queries';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import { OwnershipRatingSummaryWidget } from './OwnershipRatingSummaryWidget';
import { MajorShareholdersWidget } from './MajorShareholdersWidget';

jest.mock('@/lib/queries', () => ({
  useForeignTrading: jest.fn(),
  useInsiderSentiment: jest.fn(),
  useShareholders: jest.fn(),
}));

const shareholders = useShareholders as jest.Mock;
const foreign = useForeignTrading as jest.Mock;
const insider = useInsiderSentiment as jest.Mock;

function failedQuery() {
  return {
    data: undefined, error: new Error('Ownership feed unavailable'), isLoading: false,
    isFetching: false, dataUpdatedAt: 0, refetch: jest.fn(),
  };
}

function readyQuery(data: unknown) {
  return { ...failedQuery(), data, error: null, dataUpdatedAt: 1 };
}

const holderRows = [{ symbol: 'FPT', shareholder_name: 'Anchor', shareholder_type: 'fund', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' }];
const foreignRows = [{ buy_volume: 0, sell_volume: 0 }];
const insiderWindow = {
  symbol: 'FPT', period_days: 90, buy_count: 0, sell_count: 0,
  buy_value: 0, sell_value: 0, net_value: 0, sentiment_score: 0, total_deals: 0, value_unit: 'VND',
};

function setInputs(holders: boolean, flows: boolean, sentiment: boolean) {
  shareholders.mockReturnValue(holders ? readyQuery({ data: holderRows }) : failedQuery());
  foreign.mockReturnValue(flows ? readyQuery({ data: foreignRows }) : failedQuery());
  insider.mockReturnValue(sentiment ? readyQuery(insiderWindow) : failedQuery());
}

function expectWithheld(payload: Record<string, unknown>) {
  expect(payload).toEqual(expect.objectContaining({ score: null, grade: null, stance: null }));
  expect(getWidgetExportData(payload)).toEqual(expect.objectContaining({ score: null, grade: null, stance: null }));
  expect(screen.queryByText('Balanced ownership base')).not.toBeInTheDocument();
}

describe('OwnershipRatingSummaryWidget admission', () => {
  test('withholds header judgments and runtime/export facts when every source fails', () => {
    shareholders.mockReturnValue(failedQuery());
    foreign.mockReturnValue(failedQuery());
    insider.mockReturnValue(failedQuery());
    const onDataChange = jest.fn();

    render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);

    expect(screen.queryByText('C')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 (reported )?holders/)).not.toBeInTheDocument();
    expect(screen.queryByText('Balanced ownership base')).not.toBeInTheDocument();
    expect(screen.getByText('Ownership feed unavailable')).toBeInTheDocument();
    const payload = onDataChange.mock.calls.at(-1)?.[0];
    expect(payload).toEqual(expect.objectContaining({ score: null, grade: null, stance: null, holderCount: null }));
    expect(payload.__widgetRuntime.provenance.fetchedAt).toBeNull();
    expect(getWidgetExportData(payload)).toEqual(expect.objectContaining({ score: null, grade: null, stance: null, holderCount: null }));
  });

  test('distinguishes initial loading from successful empty observations', () => {
    const loading = { ...failedQuery(), error: null, isLoading: true, isFetching: true };
    shareholders.mockReturnValue(loading);
    foreign.mockReturnValue(loading);
    insider.mockReturnValue(loading);
    const onDataChange = jest.fn();
    const { rerender } = render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);
    expect(screen.getByText('Holder count unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No ownership summary for FPT')).not.toBeInTheDocument();

    shareholders.mockReturnValue(readyQuery({ data: [] }));
    foreign.mockReturnValue(readyQuery({ data: [] }));
    insider.mockReturnValue(readyQuery(null));
    rerender(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expect(screen.getByText('No ownership summary for FPT')).toBeInTheDocument();
    expect(screen.getByText('0 reported holders')).toBeInTheDocument();
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);
    expect(onDataChange.mock.calls.at(-1)?.[0].holderCount).toBe(0);
    expect(screen.queryByText('Ownership feed unavailable')).not.toBeInTheDocument();
  });

  test.each([
    [true, false, false], [false, true, false], [false, false, true],
    [true, true, false], [true, false, true], [false, true, true],
  ])('keeps independent facts without a composite for partial inputs %s/%s/%s', (holders, flows, sentiment) => {
    setInputs(holders, flows, sentiment);
    const onDataChange = jest.fn();
    render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    const payload = onDataChange.mock.calls.at(-1)?.[0];
    expectWithheld(payload);
    expect(payload.holderCount).toBe(holders ? 1 : null);
    expect(payload.foreignNetVolume).toBe(flows ? 0 : null);
    expect(payload.insiderNetValue).toBe(sentiment ? 0 : null);
    expect(screen.getByRole('status')).toHaveTextContent('Composite withheld');
    expect(screen.getByText('Score').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('Foreign Net 20D').nextElementSibling).toHaveTextContent(flows ? '0' : '—');
    expect(screen.getByText('Insider Net 90D').nextElementSibling).toHaveTextContent(sentiment ? '0' : '—');
  });

  test('recovers from failure to a complete view and preserves admitted zero flows', () => {
    setInputs(false, false, false);
    const onDataChange = jest.fn();
    const { rerender } = render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);

    setInputs(true, true, true);
    rerender(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    const payload = onDataChange.mock.calls.at(-1)?.[0];
    expect(payload).toEqual(expect.objectContaining({ score: 62, grade: 'C', stance: 'Balanced ownership base', foreignNetVolume: 0, insiderNetValue: 0, coverage: 'complete' }));
    expect(getWidgetExportData(payload)).toEqual(expect.objectContaining({ score: 62, grade: 'C' }));
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('Score').nextElementSibling).toHaveTextContent('62/100');
    expect(screen.queryByText('Ownership feed unavailable')).not.toBeInTheDocument();
  });

  test('discloses failed refresh while retaining previously admitted facts', () => {
    setInputs(true, true, true);
    shareholders.mockReturnValue({ ...readyQuery({ data: holderRows }), error: new Error('Refresh failed') });
    const onDataChange = jest.fn();
    render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('Shareholders: refresh failed; retained data may be stale');
    expect(screen.getByText('Refresh failed')).toBeInTheDocument();
    const payload = onDataChange.mock.calls.at(-1)?.[0];
    expect(payload.holderCount).toBe(1);
    expect(payload.__widgetRuntime.provenance).toEqual(expect.objectContaining({ stale: true, cached: true }));
    expect(getWidgetExportData(payload)).toEqual(expect.objectContaining({ holderCount: 1, warnings: expect.arrayContaining([expect.stringContaining('refresh failed')]) }));
  });

  test.each([[holderRows], [[]]])('surfaces answered envelope errors without discarding retained holders %j', (rows) => {
    const shareholderQuery = readyQuery({ data: rows, error: 'Provider refresh timed out' });
    shareholders.mockReturnValue(shareholderQuery);
    foreign.mockReturnValue(failedQuery());
    insider.mockReturnValue(failedQuery());
    const onDataChange = jest.fn();
    const tableData = jest.fn();
    render(<><section aria-label="Shareholder table"><MajorShareholdersWidget symbol="FPT" onDataChange={tableData} /></section><OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} /></>);
    const payload = onDataChange.mock.calls.at(-1)?.[0];
    expectWithheld(payload);
    if (rows.length) {
      expect(within(screen.getByRole('region', { name: 'Shareholder table' })).getByRole('cell', { name: '40.00%' })).toBeInTheDocument();
      expect(payload.top3Pct).toBe(40);
      expect(payload.__widgetRuntime.provenance).toEqual(expect.objectContaining({ stale: true, cached: true }));
      expect(tableData.mock.calls.at(-1)?.[0].__widgetRuntime.provenance).toEqual(expect.objectContaining({ stale: true, cached: true }));
    } else {
      expect(payload).toEqual(expect.objectContaining({ holderCount: 0, coverage: 'unknown' }));
      expect(getWidgetExportData(tableData.mock.calls.at(-1)?.[0])).toEqual([]);
      fireEvent.click(within(screen.getByRole('region', { name: 'Shareholder table' })).getByRole('button'));
      expect(shareholderQuery.refetch).toHaveBeenCalledTimes(1);
    }
  });

  test('does not admit a unitless insider aggregate or an empty aggregate object', () => {
    setInputs(true, true, true);
    insider.mockReturnValue(readyQuery({ ...insiderWindow, value_unit: null }));
    const onDataChange = jest.fn();
    const { rerender } = render(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);
    expect(screen.getByText('Insider Net 90D').nextElementSibling).toHaveTextContent('—');
    insider.mockReturnValue(readyQuery({}));
    rerender(<OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} />);
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);
  });

  test('uses one admitted percent cohort for table, concentration, header, runtime and export', () => {
    const percentages = [4, 3.03, 3, 2.5, 2.3, 2.2, 2, 1.8, 1.6, 1.38];
    const rows = percentages.map((ownership_pct, index) => ({
      symbol: 'FPT', shareholder_name: `Holder ${index + 1}`, ownership_pct,
      ownership_unit: 'percent', ownership_unit_status: 'explicit', ownership_source_field: 'disclosed_percent',
    }));
    shareholders.mockReturnValue(readyQuery({ data: rows }));
    foreign.mockReturnValue(readyQuery({ data: foreignRows }));
    insider.mockReturnValue(readyQuery(insiderWindow));
    const tableData = jest.fn();
    const summaryData = jest.fn();
    render(<><MajorShareholdersWidget symbol="FPT" onDataChange={tableData} /><OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={summaryData} /></>);

    percentages.forEach((value) => expect(screen.getByText(`${value.toFixed(2)}%`)).toBeInTheDocument());
    expect(screen.getByText('Top 3').nextElementSibling).toHaveTextContent('10.03%');
    expect(screen.getByText('Top 10').nextElementSibling).toHaveTextContent('23.81%');
    expect(screen.getByText('10 reported holders')).toBeInTheDocument();
    const payload = summaryData.mock.calls.at(-1)?.[0];
    expect(payload.top3Pct).toBeCloseTo(10.03);
    expect(payload.top10Pct).toBeCloseTo(23.81);
    expect(payload).toEqual(expect.objectContaining({ score: 62, grade: 'C' }));
    expect(getWidgetExportData(payload)).toEqual(expect.objectContaining({ top3Pct: payload.top3Pct, top10Pct: payload.top10Pct, grade: 'C' }));
    expect(getWidgetExportData(tableData.mock.calls.at(-1)?.[0])).toEqual(rows);
  });

  test('never rescales small explicit percents and withholds unknown units across rendered outputs', () => {
    const rows = [0.04, 0.03, 0.03].map((ownership_pct, index) => ({
      symbol: 'FPT', shareholder_name: `Small holder ${index}`, ownership_pct,
      ownership_unit: 'percent', ownership_unit_status: 'explicit',
    }));
    shareholders.mockReturnValue(readyQuery({ data: rows }));
    foreign.mockReturnValue(readyQuery({ data: foreignRows }));
    insider.mockReturnValue(readyQuery(insiderWindow));
    const onDataChange = jest.fn();
    const { rerender } = render(<><MajorShareholdersWidget symbol="FPT" /><OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} /></>);
    expect(screen.getByText('0.04%')).toBeInTheDocument();
    expect(screen.getByText('Top 3').nextElementSibling).toHaveTextContent('0.10%');

    shareholders.mockReturnValue(readyQuery({ data: rows.map((row) => ({ ...row, ownership_unit_status: 'unverified' })) }));
    rerender(<><MajorShareholdersWidget symbol="FPT" /><OwnershipRatingSummaryWidget id="ownership" symbol="FPT" onDataChange={onDataChange} /></>);
    expect(screen.queryByText('0.04%')).not.toBeInTheDocument();
    expect(screen.getByText('Top 3').nextElementSibling).toHaveTextContent('—');
    expectWithheld(onDataChange.mock.calls.at(-1)?.[0]);
    expect(screen.queryByText('62/100')).not.toBeInTheDocument();
  });
});
