import { render, screen } from '@testing-library/react';
import { IncomeSankeyChart } from './IncomeSankeyChart';
import type { IncomeSankeyModel } from '@/lib/financialVisualizations';

// The chart is the only place a node states a change, so the label must carry
// formatPercent's own states: `n/m` is meaningful and stays visible, `n/a` is
// missing and contributes nothing.
function modelWithChange(changePct: number | null): IncomeSankeyModel {
  return {
    metrics: { revenue: 50, grossProfit: 50, operatingIncome: 50, preTaxProfit: 50, netIncome: 50 },
    nodes: [
      { id: 'revenue', label: 'Revenue', stage: 0, value: 50, tone: '#1d4ed8', changePct },
    ],
    links: [],
    maxValue: 50,
    minValue: 0,
    breakdowns: { operatingExpenses: [], nonOperating: [] },
  } as unknown as IncomeSankeyModel;
}

describe('IncomeSankeyChart node delta label', () => {
  it('keeps a non-meaningful change visible as n/m', () => {
    render(<IncomeSankeyChart model={modelWithChange(1000)} formatValue={(v) => v.toFixed(2)} />);
    expect(screen.getByText(/n\/m/)).toBeInTheDocument();
  });

  it('omits a missing change instead of adding a stray label', () => {
    const { container } = render(
      <IncomeSankeyChart model={modelWithChange(null)} formatValue={(v) => v.toFixed(2)} />,
    );
    expect(container.textContent).not.toMatch(/n\/a/);
  });
});
