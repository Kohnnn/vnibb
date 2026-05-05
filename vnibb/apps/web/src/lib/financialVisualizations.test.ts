import { buildCashFlowWaterfallModel, buildIncomeSankeyModel } from '@/lib/financialVisualizations';

describe('financial visualizations helpers', () => {
  test('buildIncomeSankeyModel maps a basic income statement into flow nodes', () => {
    const model = buildIncomeSankeyModel([
      {
        symbol: 'MSH',
        period: '2024',
        revenue: 1000,
        cost_of_revenue: 620,
        gross_profit: 380,
        operating_income: 180,
        tax_expense: 20,
        net_income: 140,
      },
      {
        symbol: 'MSH',
        period: '2025',
        revenue: 1200,
        cost_of_revenue: 690,
        gross_profit: 510,
        operating_income: 240,
        interest_expense: 20,
        other_income: 10,
        pre_tax_profit: 230,
        tax_expense: 30,
        net_income: 190,
      },
    ]);

    expect(model).not.toBeNull();
    expect(model?.nodes.find((node) => node.id === 'gross_profit')?.value).toBe(510);
    expect(model?.links.find((link) => link.source === 'revenue' && link.target === 'cost_of_revenue')?.value).toBe(690);
    expect(model?.nodes.find((node) => node.id === 'pre_tax_profit')?.value).toBe(230);
    expect(model?.links.find((link) => link.source === 'pre_tax_profit' && link.target === 'net_income')?.value).toBe(190);
    expect(model?.nodes.find((node) => node.id === 'operating_expenses')?.value).toBe(270);
    expect(model?.nodes.find((node) => node.id === 'non_operating_drag')?.value).toBe(10);
  });

  test('buildIncomeSankeyModel keeps operating expense detail in breakdown metadata', () => {
    const model = buildIncomeSankeyModel([
      {
        symbol: 'MSH',
        period: '2025',
        revenue: 1000,
        gross_profit: 400,
        selling_general_admin: 80,
        research_development: 40,
        depreciation: 20,
        operating_income: 260,
        net_income: 180,
      },
    ]);

    expect(model?.nodes.find((node) => node.id === 'operating_expenses')?.value).toBe(140);
    expect(model?.breakdowns.operatingExpenses.find((node) => node.id === 'selling_general_admin')?.value).toBe(80);
    expect(model?.breakdowns.operatingExpenses.find((node) => node.id === 'research_development')?.value).toBe(40);
    expect(model?.links.find((link) => link.target === 'operating_income')?.value).toBe(260);
  });

  test('buildCashFlowWaterfallModel creates a clean bridge to net change', () => {
    const model = buildCashFlowWaterfallModel([
      {
        symbol: 'MSH',
        period: '2025',
        operating_cash_flow: 300,
        capex: -90,
        investing_cash_flow: -180,
        financing_cash_flow: 40,
        dividends_paid: -20,
        debt_repayment: -15,
        net_change_in_cash: 160,
        free_cash_flow: 210,
      },
    ]);

    expect(model).not.toBeNull();
    expect(model?.steps[0]).toMatchObject({ label: 'Operating CF', start: 0, end: 300 });
    expect(model?.steps[1]).toMatchObject({ label: 'CapEx', start: 300, end: 210 });
    expect(model?.steps.find((step) => step.id === 'free_cash_flow')).toBeUndefined();
    expect(model?.steps.find((step) => step.id === 'other_investing_cash_flow')).toMatchObject({ start: 210, value: -90, end: 120 });
    expect(model?.steps.find((step) => step.id === 'dividends_paid')).toMatchObject({ start: 120, value: -20, end: 100 });
    expect(model?.steps.find((step) => step.id === 'debt_repayment')).toMatchObject({ start: 100, value: -15, end: 85 });
    expect(model?.steps.find((step) => step.id === 'other_financing_cash_flow')).toMatchObject({ label: 'Financing Inflows', start: 85, value: 75, end: 160 });
    expect(model?.steps.at(-1)).toMatchObject({ label: 'Net Change', end: 160, tone: 'total' });
  });
});
