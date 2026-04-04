import { calculatePercentChange } from '@/lib/units';
import { periodSortKey } from '@/lib/financialPeriods';
import type { CashFlowData, IncomeStatementData } from '@/types/equity';

export interface FinancialFlowNode {
  id: string;
  label: string;
  value: number;
  stage: number;
  tone: string;
  changePct?: number | null;
}

export interface FinancialFlowBreakdownItem {
  id: string;
  label: string;
  value: number;
  tone: string;
  changePct?: number | null;
}

export interface FinancialFlowLink {
  source: string;
  target: string;
  value: number;
  tone: string;
}

export interface IncomeSankeyModel {
  period: string;
  nodes: FinancialFlowNode[];
  links: FinancialFlowLink[];
  maxValue: number;
  breakdowns: {
    operatingExpenses: FinancialFlowBreakdownItem[];
    nonOperating: FinancialFlowBreakdownItem[];
  };
  metrics: {
    revenue: number;
    grossProfit: number;
    operatingIncome: number;
    preTaxProfit: number;
    netIncome: number;
  };
}

export interface WaterfallStep {
  id: string;
  label: string;
  value: number;
  start: number;
  end: number;
  tone: 'positive' | 'negative' | 'total';
  changePct?: number | null;
}

export interface CashFlowWaterfallModel {
  period: string;
  steps: WaterfallStep[];
  minValue: number;
  maxValue: number;
  summary: {
    freeCashFlow: number | null;
    capex: number | null;
    dividends: number | null;
    netChange: number;
  };
}

function sortByPeriod<T extends { period?: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period));
}

function asPositive(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.abs(value);
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function buildIncomeSankeyModel(rows: IncomeStatementData[]): IncomeSankeyModel | null {
  const ordered = sortByPeriod(rows).filter((row) => row.period);
  const latest = ordered.at(-1);
  if (!latest) return null;

  const previous = ordered.length > 1 ? ordered.at(-2) ?? null : null;
  const revenue = asPositive(latest.revenue);
  if (revenue <= 0) return null;

  const costOfRevenue = asPositive(latest.cost_of_revenue);
  const reportedGrossProfit = asPositive(latest.gross_profit);
  const grossProfit = reportedGrossProfit || Math.max(revenue - costOfRevenue, 0);
  const sellingGeneralAdmin = asPositive(latest.selling_general_admin);
  const researchDevelopment = asPositive(latest.research_development);
  const depreciation = asPositive(latest.depreciation);
  const explicitOpex = firstFinite(
    asPositive(latest.operating_expense),
    sellingGeneralAdmin + researchDevelopment + depreciation,
  ) ?? 0;
  const operatingIncome = asPositive(latest.operating_income);
  const operatingExpenses = explicitOpex || Math.max(grossProfit - operatingIncome, 0);
  const otherOperatingExpenses = Math.max(
    operatingExpenses - sellingGeneralAdmin - researchDevelopment - depreciation,
    0,
  );
  const interestExpense = asPositive(latest.interest_expense);
  const otherIncome = asPositive(latest.other_income);
  const reportedPreTaxProfit = asPositive(latest.pre_tax_profit ?? latest.profit_before_tax);
  const preTaxProfit = reportedPreTaxProfit || Math.max(operatingIncome + otherIncome - interestExpense, 0);
  const taxExpense = asPositive(latest.tax_expense);
  const netIncome = asPositive(latest.net_income);
  const nonOperatingAdjustment = preTaxProfit - operatingIncome;
  const nonOperatingAbs = Math.abs(nonOperatingAdjustment);
  const taxAdjustment = netIncome - preTaxProfit;
  const taxAbs = Math.abs(taxAdjustment);
  const previousOperatingExpenses = previous ? firstFinite(
    asPositive(previous.operating_expense),
    asPositive(previous.selling_general_admin) + asPositive(previous.research_development) + asPositive(previous.depreciation),
  ) : null;
  const previousPreTaxProfit = previous
    ? firstFinite(previous.pre_tax_profit ?? previous.profit_before_tax, null)
    : null;
  const previousNonOperatingAdjustment = previousPreTaxProfit === null
    ? null
    : previousPreTaxProfit - asPositive(previous?.operating_income);
  const previousTaxAdjustment = previousPreTaxProfit === null
    ? null
    : asPositive(previous?.net_income) - previousPreTaxProfit;

  const operatingExpenseBreakdown: FinancialFlowBreakdownItem[] = [
    {
      id: 'selling_general_admin',
      label: 'SG&A',
      value: sellingGeneralAdmin,
      tone: '#f97316',
      changePct: calculatePercentChange(latest.selling_general_admin ?? null, previous?.selling_general_admin ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'research_development',
      label: 'R&D',
      value: researchDevelopment,
      tone: '#fb923c',
      changePct: calculatePercentChange(latest.research_development ?? null, previous?.research_development ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'depreciation',
      label: 'Depreciation',
      value: depreciation,
      tone: '#fdba74',
      changePct: calculatePercentChange(latest.depreciation ?? null, previous?.depreciation ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'other_operating_expenses',
      label: 'Other OpEx',
      value: otherOperatingExpenses,
      tone: '#f59e0b',
      changePct: null,
    },
  ].filter((item) => item.value > 0);

  const nonOperatingBreakdown: FinancialFlowBreakdownItem[] = [
    {
      id: 'other_income',
      label: 'Other Income',
      value: otherIncome,
      tone: '#38bdf8',
      changePct: calculatePercentChange(latest.other_income ?? null, previous?.other_income ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'interest_expense',
      label: 'Interest Expense',
      value: interestExpense,
      tone: '#fb7185',
      changePct: calculatePercentChange(latest.interest_expense ?? null, previous?.interest_expense ?? null, { clamp: 'yoy_change' }),
    },
  ].filter((item) => item.value > 0);

  const nodes: FinancialFlowNode[] = [
    {
      id: 'revenue',
      label: 'Revenue',
      value: revenue,
      stage: 0,
      tone: '#1d4ed8',
      changePct: calculatePercentChange(latest.revenue ?? null, previous?.revenue ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'cost_of_revenue',
      label: 'Cost of Revenue',
      value: costOfRevenue,
      stage: 1,
      tone: '#ef4444',
      changePct: calculatePercentChange(latest.cost_of_revenue ?? null, previous?.cost_of_revenue ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'gross_profit',
      label: 'Gross Profit',
      value: grossProfit,
      stage: 1,
      tone: '#2563eb',
      changePct: calculatePercentChange(latest.gross_profit ?? null, previous?.gross_profit ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: 'operating_expenses',
      label: 'Operating Expenses',
      value: operatingExpenses,
      stage: 2,
      tone: '#f59e0b',
      changePct: calculatePercentChange(operatingExpenses, previousOperatingExpenses, { clamp: 'yoy_change' }),
    },
    {
      id: 'operating_income',
      label: 'Operating Income',
      value: operatingIncome,
      stage: 2,
      tone: '#22c55e',
      changePct: calculatePercentChange(latest.operating_income ?? null, previous?.operating_income ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: nonOperatingAdjustment >= 0 ? 'non_operating_gain' : 'non_operating_drag',
      label: nonOperatingAdjustment >= 0 ? 'Net Non-Op Gain' : 'Net Non-Op Drag',
      value: nonOperatingAbs,
      stage: 3,
      tone: nonOperatingAdjustment >= 0 ? '#38bdf8' : '#fb7185',
      changePct: calculatePercentChange(nonOperatingAdjustment, previousNonOperatingAdjustment, { clamp: 'yoy_change' }),
    },
    {
      id: 'pre_tax_profit',
      label: 'Pre-tax Profit',
      value: preTaxProfit,
      stage: 3,
      tone: '#14b8a6',
      changePct: calculatePercentChange((latest.pre_tax_profit ?? latest.profit_before_tax) ?? null, (previous?.pre_tax_profit ?? previous?.profit_before_tax) ?? null, { clamp: 'yoy_change' }),
    },
    {
      id: taxAdjustment <= 0 ? 'tax_expense' : 'tax_benefit',
      label: taxAdjustment <= 0 ? 'Tax Expense' : 'Tax Benefit',
      value: taxAbs,
      stage: 4,
      tone: taxAdjustment <= 0 ? '#f59e0b' : '#38bdf8',
      changePct: calculatePercentChange(taxAdjustment, previousTaxAdjustment, { clamp: 'yoy_change' }),
    },
    {
      id: 'net_income',
      label: 'Net Income',
      value: netIncome,
      stage: 4,
      tone: '#10b981',
      changePct: calculatePercentChange(latest.net_income ?? null, previous?.net_income ?? null, { clamp: 'yoy_change' }),
    },
  ].filter((node) => node.value > 0);

  const links: FinancialFlowLink[] = [
    { source: 'revenue', target: 'cost_of_revenue', value: costOfRevenue, tone: '#fca5a5' },
    { source: 'revenue', target: 'gross_profit', value: grossProfit, tone: '#93c5fd' },
    { source: 'gross_profit', target: 'operating_expenses', value: operatingExpenses, tone: '#fcd34d' },
    { source: 'gross_profit', target: 'operating_income', value: operatingIncome, tone: '#86efac' },
    ...(nonOperatingAdjustment >= 0
      ? [
          { source: 'operating_income', target: 'pre_tax_profit', value: operatingIncome, tone: '#5eead4' },
          { source: 'non_operating_gain', target: 'pre_tax_profit', value: nonOperatingAbs, tone: '#7dd3fc' },
        ]
      : [
          { source: 'operating_income', target: 'non_operating_drag', value: nonOperatingAbs, tone: '#fda4af' },
          { source: 'operating_income', target: 'pre_tax_profit', value: preTaxProfit, tone: '#5eead4' },
        ]),
    ...(taxAdjustment <= 0
      ? [
          { source: 'pre_tax_profit', target: 'tax_expense', value: taxAbs, tone: '#fcd34d' },
          { source: 'pre_tax_profit', target: 'net_income', value: netIncome, tone: '#6ee7b7' },
        ]
      : [
          { source: 'pre_tax_profit', target: 'net_income', value: preTaxProfit, tone: '#6ee7b7' },
          { source: 'tax_benefit', target: 'net_income', value: taxAbs, tone: '#7dd3fc' },
        ]),
  ].filter((link) => link.value > 0);

  const maxValue = Math.max(...nodes.map((node) => node.value), revenue);

  return {
    period: String(latest.period),
    nodes,
    links,
    maxValue,
    breakdowns: {
      operatingExpenses: operatingExpenseBreakdown,
      nonOperating: nonOperatingBreakdown,
    },
    metrics: {
      revenue,
      grossProfit,
      operatingIncome,
      preTaxProfit,
      netIncome,
    },
  };
}

export function buildCashFlowWaterfallModel(rows: CashFlowData[]): CashFlowWaterfallModel | null {
  const ordered = sortByPeriod(rows).filter((row) => row.period);
  const latest = ordered.at(-1);
  if (!latest) return null;

  const previous = ordered.length > 1 ? ordered.at(-2) ?? null : null;
  const operating = firstFinite(latest.operating_cash_flow, 0) ?? 0;
  const investing = firstFinite(latest.investing_cash_flow, 0) ?? 0;
  const financing = firstFinite(latest.financing_cash_flow, 0) ?? 0;
  const capex = firstFinite(latest.capex, latest.capital_expenditure, null);
  const dividends = firstFinite(latest.dividends_paid, null);
  const debtRepayment = firstFinite(latest.debt_repayment, null);
  const stockRepurchased = firstFinite(latest.stock_repurchased, null);
  const freeCashFlow = firstFinite(latest.free_cash_flow, capex !== null ? operating + capex : null);
  const netChange = firstFinite(latest.net_change_in_cash, latest.net_cash_flow, operating + investing + financing) ?? 0;
  const otherInvesting = capex !== null ? investing - capex : investing;
  const financingAdjustments = [dividends, debtRepayment, stockRepurchased].reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
  const otherFinancing = financing - financingAdjustments;
  const previousOtherInvesting =
    (firstFinite(previous?.investing_cash_flow, 0) ?? 0) -
    (firstFinite(previous?.capex, previous?.capital_expenditure, null) ?? 0);
  const previousFinancingAdjustments = [
    previous?.dividends_paid,
    previous?.debt_repayment,
    previous?.stock_repurchased,
  ].reduce<number>((total, value) => total + (value ?? 0), 0);
  const hasMeaningfulValue = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.000001;

  let running = 0;
  const steps: WaterfallStep[] = [
    {
      id: 'operating_cash_flow',
      label: 'Operating CF',
      value: operating,
      start: running,
      end: running + operating,
      tone: operating >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(latest.operating_cash_flow ?? null, previous?.operating_cash_flow ?? null, { clamp: 'yoy_change' }),
    },
  ];
  running += operating;
  if (capex !== null) {
    steps.push({
      id: 'capex',
      label: 'CapEx',
      value: capex,
      start: running,
      end: running + capex,
      tone: capex >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(capex, firstFinite(previous?.capex, previous?.capital_expenditure, null), { clamp: 'yoy_change' }),
    });
    running += capex;
  }
  if (hasMeaningfulValue(otherInvesting)) {
    steps.push({
      id: 'other_investing_cash_flow',
      label: 'Other Investing',
      value: otherInvesting,
      start: running,
      end: running + otherInvesting,
      tone: otherInvesting >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(otherInvesting, previousOtherInvesting, { clamp: 'yoy_change' }),
    });
    running += otherInvesting;
  }
  if (dividends !== null) {
    steps.push({
      id: 'dividends_paid',
      label: 'Dividends',
      value: dividends,
      start: running,
      end: running + dividends,
      tone: dividends >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(dividends, previous?.dividends_paid ?? null, { clamp: 'yoy_change' }),
    });
    running += dividends;
  }
  if (debtRepayment !== null) {
    steps.push({
      id: 'debt_repayment',
      label: 'Debt Repayment',
      value: debtRepayment,
      start: running,
      end: running + debtRepayment,
      tone: debtRepayment >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(debtRepayment, previous?.debt_repayment ?? null, { clamp: 'yoy_change' }),
    });
    running += debtRepayment;
  }
  if (stockRepurchased !== null) {
    steps.push({
      id: 'stock_repurchased',
      label: 'Buybacks',
      value: stockRepurchased,
      start: running,
      end: running + stockRepurchased,
      tone: stockRepurchased >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(stockRepurchased, previous?.stock_repurchased ?? null, { clamp: 'yoy_change' }),
    });
    running += stockRepurchased;
  }
  if (hasMeaningfulValue(otherFinancing)) {
    steps.push({
      id: 'other_financing_cash_flow',
      label: otherFinancing >= 0 ? 'Financing Inflows' : 'Other Financing',
      value: otherFinancing,
      start: running,
      end: running + otherFinancing,
      tone: otherFinancing >= 0 ? 'positive' : 'negative',
      changePct: calculatePercentChange(
        otherFinancing,
        (previous?.financing_cash_flow ?? 0) - previousFinancingAdjustments,
        { clamp: 'yoy_change' },
      ),
    });
    running += otherFinancing;
  }
  steps.push({
    id: 'net_change_in_cash',
    label: 'Net Change',
    value: netChange,
    start: 0,
    end: netChange,
    tone: 'total',
    changePct: calculatePercentChange(netChange, previous?.net_change_in_cash ?? previous?.net_cash_flow ?? null, { clamp: 'yoy_change' }),
  });

  const extents = steps.flatMap((step) => [step.start, step.end, 0]);
  const minValue = Math.min(...extents);
  const maxValue = Math.max(...extents);

  return {
    period: String(latest.period),
    steps,
    minValue,
    maxValue,
    summary: {
      freeCashFlow,
      capex,
      dividends,
      netChange,
    },
  };
}
