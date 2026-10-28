import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useIncomeStatement } from '@/lib/queries';
import { DEFAULT_UNIT_CONFIG } from '@/lib/units';
import type { IncomeStatementResponse } from '@/types/equity';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({ useIncomeStatement: jest.fn() }));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({ config: DEFAULT_UNIT_CONFIG }),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, title, headerActions }: { children: React.ReactNode; title: string; headerActions: React.ReactNode }) => (
    <section aria-label={title}>{headerActions}{children}</section>
  ),
}));

const incomeQuery = jest.mocked(useIncomeStatement);
const IncomeWidget = widgetRegistry.get('income_sankey')!.component;
const row = {
  symbol: 'FPT', period: '2025FY', revenue: 1000, cost_of_revenue: 600,
  gross_profit: 400, operating_income: 300, pre_tax_profit: 280, net_income: 250,
};

function showIncome(rows: typeof row[], error: Error | null = null) {
  incomeQuery.mockReturnValue({
    data: { symbol: 'FPT', count: rows.length, data: rows }, isLoading: false, isFetching: false,
    error, dataUpdatedAt: 1750000000000, refetch: jest.fn(),
  } as unknown as UseQueryResult<IncomeStatementResponse, Error>);
  const onDataChange = jest.fn();
  render(<React.Suspense fallback={<div>Loading widget</div>}><IncomeWidget id="income-saved" symbol="FPT" onDataChange={onDataChange} /></React.Suspense>);
  return onDataChange;
}

describe('income_sankey saved dashboard widget', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders actual revenue-to-profit flow and reports available periods', async () => {
    const onDataChange = showIncome([row]);
    const widget = await screen.findByRole('region', { name: 'Income Sankey' });
    expect(widget.querySelectorAll('svg[viewBox="0 0 1120 420"] path').length).toBeGreaterThan(0);
    const flowPaths = Array.from(widget.querySelectorAll('svg[viewBox="0 0 1120 420"] path'));
    expect(flowPaths.every((path) => /^M \d+(?:\.\d+)? \d+(?:\.\d+)? C /.test(path.getAttribute('d') ?? ''))).toBe(true);
    expect(screen.getByText('Cost of Revenue')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: false }) }),
    }));
  });

  it('reports unusable statements as empty rather than treating a row without revenue as a chart', async () => {
    const onDataChange = showIncome([{ ...row, revenue: 0 }]);
    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Income Sankey' })?.querySelector('svg[viewBox="0 0 1120 420"]')).toBeNull();
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    }));
  });

  it('does not chart a loss as a positive net income flow', async () => {
    const onDataChange = showIncome([{ ...row, net_income: -25 }]);
    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(screen.getByText(/losses cannot be shown as positive ribbons/i)).toBeInTheDocument();
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    }));
  });

  it('does not mistake an annual row for a quarterly flow', async () => {
    const onDataChange = showIncome([row]);
    await screen.findByRole('region', { name: 'Income Sankey' });
    fireEvent.click(screen.getByRole('button', { name: /^Q$/ }));
    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    }));
    expect(incomeQuery).toHaveBeenLastCalledWith('FPT', { period: 'Q' });
  });

  it('charts the selected quarter rather than the latest quarter in the response', async () => {
    showIncome([
      { ...row, period: 'Q1-2025', revenue: 700, cost_of_revenue: 400, gross_profit: 300, operating_income: 200, pre_tax_profit: 180, net_income: 150 },
      { ...row, period: '2025Q4', revenue: 3000, cost_of_revenue: 1700, gross_profit: 1300, operating_income: 900, pre_tax_profit: 850, net_income: 800 },
    ]);
    await screen.findByRole('region', { name: 'Income Sankey' });

    fireEvent.click(screen.getByRole('button', { name: 'Q1' }));

    expect(screen.getByText('Q1 2025', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('700.00')).toHaveLength(2);
    expect(screen.queryByText('3,000.00')).not.toBeInTheDocument();
  });

  it('switches selected quarters and keeps Q showing the latest quarterly flow', async () => {
    showIncome([
      { ...row, period: 'Q1-2025', revenue: 700, cost_of_revenue: 400, gross_profit: 300, operating_income: 200, pre_tax_profit: 180, net_income: 150 },
      { ...row, period: 'Q4-2025', revenue: 900, cost_of_revenue: 500, gross_profit: 400, operating_income: 300, pre_tax_profit: 280, net_income: 250 },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Q1' }));
    expect(screen.getAllByText('700.00')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Q4' }));
    expect(screen.getAllByText('900.00')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Q' }));
    expect(screen.getByText('900.00')).toBeInTheDocument();
  });

  it('preserves a trailing-twelve-month flow when TTM is selected', async () => {
    showIncome([{ ...row, period: 'TTM-2025', revenue: 800, cost_of_revenue: 450, gross_profit: 350, operating_income: 250, pre_tax_profit: 230, net_income: 200 }]);
    fireEvent.click(screen.getByRole('button', { name: 'TTM' }));

    expect(screen.getAllByText('800.00')).toHaveLength(2);
    expect(screen.getByText('TTM 2025', { exact: false })).toBeInTheDocument();
  });

  it('does not chart a quarterly flow as TTM when the response carries no TTM row', async () => {
    showIncome([{ ...row, period: 'Q3-2025', revenue: 800, cost_of_revenue: 450, gross_profit: 350, operating_income: 250, pre_tax_profit: 230, net_income: 200 }]);
    fireEvent.click(screen.getByRole('button', { name: 'TTM' }));

    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(screen.queryByText('800.00')).not.toBeInTheDocument();
  });

  it('discloses an uncertified TTM row instead of rendering a blank flow', async () => {
    showIncome([{
      ...row, period: 'TTM-2025', revenue: undefined, cost_of_revenue: undefined, gross_profit: undefined,
      operating_income: undefined, pre_tax_profit: undefined, net_income: undefined,
      unavailable_reason: 'unknown_source_unit',
    } as unknown as typeof row]);
    await screen.findByRole('region', { name: 'Income Sankey' });
    fireEvent.click(screen.getByRole('button', { name: 'TTM' }));

    expect(await screen.findByText('Income flow unavailable for FPT')).toBeInTheDocument();
    expect(screen.getAllByText(/TTM-2025 returned no certified value \(unknown_source_unit\)/).length).toBeGreaterThan(0);
  });

  it('discloses an uncertified period while still charting the certified ones', async () => {
    showIncome([
      { ...row, period: '2024', revenue: 900, cost_of_revenue: 500, gross_profit: 400, operating_income: 300, pre_tax_profit: 280, net_income: 250 },
      {
        ...row, period: '2025', revenue: undefined, cost_of_revenue: undefined, gross_profit: undefined,
        operating_income: undefined, pre_tax_profit: undefined, net_income: undefined,
        unavailable_reason: 'conflicting_duplicate_period',
      } as unknown as typeof row,
    ]);

    const widget = await screen.findByRole('region', { name: 'Income Sankey' });
    // The certified period is still charted ...
    expect(widget.querySelectorAll('svg[viewBox="0 0 1120 420"] path').length).toBeGreaterThan(0);
    // ... and the uncertified period's reason is visible rather than silently dropped.
    expect(screen.getAllByText(/2025 returned no certified value \(conflicting_duplicate_period\)/).length).toBeGreaterThan(0);
  });

  it('reports an unavailable selected quarter rather than charting a different usable quarter', async () => {
    const onDataChange = showIncome([
      { ...row, period: 'Q1-2025', revenue: 700 },
      { ...row, period: 'Q4-2025', revenue: 900 },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Q2' }));

    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(screen.queryByText('900.00')).not.toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    }));
  });

  it('does not replace a loss in the selected quarter with a profitable quarter', async () => {
    showIncome([
      { ...row, period: 'Q1-2025', net_income: -25 },
      { ...row, period: 'Q4-2025', revenue: 900 },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Q1' }));

    expect(await screen.findByText('No flow visualization available for FPT')).toBeInTheDocument();
    expect(screen.queryByText('900.00')).not.toBeInTheDocument();
  });

  it('shows cached flow while a refresh fails instead of replacing it with an error', async () => {
    const onDataChange = showIncome([row], new Error('Offline'));
    expect((await screen.findByRole('region', { name: 'Income Sankey' })).querySelectorAll('svg[viewBox="0 0 1120 420"] path').length).toBeGreaterThan(0);
    expect(screen.getByText('Cached')).toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ stale: true }) }),
    })));
  });
});
