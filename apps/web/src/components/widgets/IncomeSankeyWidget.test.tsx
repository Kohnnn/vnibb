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

  it('shows cached flow while a refresh fails instead of replacing it with an error', async () => {
    const onDataChange = showIncome([row], new Error('Offline'));
    expect((await screen.findByRole('region', { name: 'Income Sankey' })).querySelectorAll('svg[viewBox="0 0 1120 420"] path').length).toBeGreaterThan(0);
    expect(screen.getByText('Cached')).toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ stale: true }) }),
    })));
  });
});
