import { render, screen } from '@testing-library/react';
import { useForeignTrading, useInsiderSentiment, useShareholders } from '@/lib/queries';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import { OwnershipRatingSummaryWidget } from './OwnershipRatingSummaryWidget';

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

const holderRows = [{ symbol: 'FPT', shareholder_name: 'Anchor', shareholder_type: 'fund', ownership_pct: 40 }];
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
});
