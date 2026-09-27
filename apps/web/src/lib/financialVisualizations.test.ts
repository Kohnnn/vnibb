import { buildIncomeSankeyModel } from './financialVisualizations';
import type { IncomeStatementData } from '@/types/equity';

const profitable: IncomeStatementData = {
  symbol: 'FPT', period: '2025FY', revenue: 1000, cost_of_revenue: 600,
  gross_profit: 400, operating_income: 300, pre_tax_profit: 280, net_income: 250,
};

describe('income statement flow', () => {
  it('sends tax benefits forward into net income, never backwards or within one stage', () => {
    const model = buildIncomeSankeyModel([{ ...profitable, pre_tax_profit: 280, net_income: 320, tax_expense: -40 }]);
    expect(model).not.toBeNull();
    const stages = new Map(model!.nodes.map((node) => [node.id, node.stage]));
    expect(model!.links.every((link) => (stages.get(link.source) ?? Infinity) < (stages.get(link.target) ?? -Infinity))).toBe(true);
    expect(model!.links.find((link) => link.source === 'tax_benefit')).toEqual(expect.objectContaining({
      target: 'net_income', value: 40,
    }));
  });

  it('separates an operating gain from pre-tax profit without a same-stage ribbon', () => {
    const model = buildIncomeSankeyModel([{ ...profitable, pre_tax_profit: 330, net_income: 300, other_income: 30 }]);
    const stages = new Map(model!.nodes.map((node) => [node.id, node.stage]));
    expect(model!.links.every((link) => (stages.get(link.source) ?? Infinity) < (stages.get(link.target) ?? -Infinity))).toBe(true);
    expect(model!.links.find((link) => link.source === 'non_operating_gain')).toEqual(expect.objectContaining({
      target: 'pre_tax_profit', value: 30,
    }));
  });

  it('does not show ribbons with a larger outgoing value than a reported profit stage', () => {
    const model = buildIncomeSankeyModel([{ ...profitable, cost_of_revenue: 800, gross_profit: 400 }]);
    expect(model).toBeNull();
  });

  it.each([
    { gross_profit: 0 },
    { operating_income: 0 },
    { pre_tax_profit: 0 },
    { net_income: 0 },
    { net_income: undefined },
    { gross_profit: undefined, cost_of_revenue: undefined },
    { operating_income: undefined, gross_profit: undefined },
    { net_income: Number.NaN },
    { net_income: Number.POSITIVE_INFINITY },

  ])('does not present an absent or zero profit stage as a complete income flow: %j', (stage) => {
    expect(buildIncomeSankeyModel([{ ...profitable, ...stage }])).toBeNull();
  });

  it.each([
    { net_income: -40 },
    { pre_tax_profit: -20, net_income: -30 },
    { operating_income: -10, pre_tax_profit: -20, net_income: -30 },
    { gross_profit: -10, operating_income: -20, pre_tax_profit: -30, net_income: -40 },
  ])('does not convert a reported loss into a positive profit ribbon: %j', (loss) => {
    expect(buildIncomeSankeyModel([{ ...profitable, ...loss }])).toBeNull();
  });
});
