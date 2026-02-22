// TypeScript types for equity/stock data from backend API

export interface EquityHistoricalData {
  symbol: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EquityHistoricalResponse {
  symbol: string;
  count: number;
  data: EquityHistoricalData[];
}

export interface EquityProfileData {
  symbol: string;
  company_name?: string;
  short_name?: string;
  industry?: string;
  exchange?: string;
  website?: string;
  company_type?: string;
  established_year?: number;
  no_employees?: number;
  outstanding_shares?: number;
  listed_date?: string;
}

export interface EquityProfileResponse {
  symbol: string;
  data: EquityProfileData | null;
}

export interface CompanyNewsData {
  symbol: string;
  title: string;
  source?: string;
  published_at?: string;
  url?: string;
  summary?: string;
  category?: string;
}

export interface CompanyNewsResponse {
  symbol: string;
  count: number;
  data: CompanyNewsData[];
}

export interface CompanyEventData {
  symbol: string;
  event_type?: string;
  event_name?: string;
  event_date?: string;
  ex_date?: string;
  record_date?: string;
  payment_date?: string;
  description?: string;
  value?: string;
}

export interface CompanyEventsResponse {
  symbol: string;
  count: number;
  data: CompanyEventData[];
}

export interface ShareholderData {
  symbol: string;
  shareholder_name?: string;
  shares_owned?: number;
  ownership_pct?: number;
  shareholder_type?: string;
}

export interface ShareholdersResponse {
  symbol: string;
  count: number;
  data: ShareholderData[];
}

export interface OfficerData {
  symbol: string;
  name?: string;
  position?: string;
  shares_owned?: number;
  ownership_pct?: number;
}

export interface OfficersResponse {
  symbol: string;
  count: number;
  data: OfficerData[];
}

export interface IntradayTradeData {
  symbol: string;
  time?: string;
  price?: number;
  volume?: number;
  change?: number;
  change_pct?: number;
  match_type?: string;
}

export interface IntradayResponse {
  symbol: string;
  count: number;
  data: IntradayTradeData[];
}

export interface FinancialRatioData {
  symbol: string;
  period?: string;
  pe?: number;
  pb?: number;
  ps?: number;
  ev_ebitda?: number;
  ev_sales?: number;
  roe?: number;
  roa?: number;
  eps?: number;
  bvps?: number;
  debt_equity?: number;
  debt_assets?: number;
  equity_multiplier?: number;
  current_ratio?: number;
  quick_ratio?: number;
  cash_ratio?: number;
  asset_turnover?: number;
  inventory_turnover?: number;
  receivables_turnover?: number;
  gross_margin?: number;
  operating_margin?: number;
  net_margin?: number;
  interest_coverage?: number;
  debt_service_coverage?: number;
  ocf_debt?: number;
  fcf_yield?: number;
  ocf_sales?: number;
  dps?: number;
  dividend_yield?: number;
  payout_ratio?: number;
  peg_ratio?: number;
}

export interface FinancialRatiosResponse {
  symbol: string;
  count: number;
  data: FinancialRatioData[];
}

export interface RatioHistoryPoint {
  period: string;
  pe?: number;
  pb?: number;
  ps?: number;
  ev_ebitda?: number;
  ev_sales?: number;
}

export interface RatioHistoryResponse {
  data: RatioHistoryPoint[];
  meta?: {
    count: number;
  };
  error?: string | null;
}

export interface ForeignTradingData {
  symbol: string;
  date?: string;
  buy_volume?: number;
  sell_volume?: number;
  buy_value?: number;
  sell_value?: number;
  net_volume?: number;
  net_value?: number;
}

export interface ForeignTradingResponse {
  symbol: string;
  count: number;
  data: ForeignTradingData[];
}

export interface SubsidiaryData {
  symbol: string;
  company_name?: string;
  ownership_pct?: number;
  charter_capital?: number;
}

export interface SubsidiariesResponse {
  symbol: string;
  count: number;
  data: SubsidiaryData[];
}

export interface BalanceSheetData {
  symbol: string;
  period?: string;
  total_assets?: number;
  current_assets?: number;
  fixed_assets?: number;
  total_liabilities?: number;
  current_liabilities?: number;
  long_term_liabilities?: number;
  short_term_debt?: number;
  long_term_debt?: number;
  equity?: number;
  total_equity?: number;
  retained_earnings?: number;
  cash?: number;
  inventory?: number;
  receivables?: number;
  accounts_receivable?: number;
  accounts_payable?: number;
  goodwill?: number;
  intangible_assets?: number;
}

export interface BalanceSheetResponse {
  symbol: string;
  count: number;
  data: BalanceSheetData[];
}

export interface IncomeStatementData {
  symbol: string;
  period?: string;
  revenue?: number;
  cost_of_revenue?: number;
  gross_profit?: number;
  selling_general_admin?: number;
  research_development?: number;
  depreciation?: number;
  operating_expense?: number;
  operating_income?: number;
  interest_expense?: number;
  other_income?: number;
  pre_tax_profit?: number;
  profit_before_tax?: number;
  tax_expense?: number;
  net_income?: number;
  eps?: number;
  eps_diluted?: number;
}

export interface IncomeStatementResponse {
  symbol: string;
  count: number;
  data: IncomeStatementData[];
}

export interface CashFlowData {
  symbol: string;
  period?: string;
  operating_cash_flow?: number;
  investing_cash_flow?: number;
  financing_cash_flow?: number;
  net_cash_flow?: number;
  net_change_in_cash?: number;
  free_cash_flow?: number;
  capex?: number;
  capital_expenditure?: number;
  dividends_paid?: number;
  debt_repayment?: number;
  stock_repurchased?: number;
}

export interface CashFlowResponse {
  symbol: string;
  count: number;
  data: CashFlowData[];
}

export interface MarketIndexData {
  index_name: string;
  current_value?: number;
  change?: number;
  change_pct?: number;
  volume?: number;
  high?: number;
  low?: number;
}

export interface MarketOverviewResponse {
  count: number;
  data: MarketIndexData[];
}
