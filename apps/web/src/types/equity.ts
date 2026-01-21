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
  roe?: number;
  roa?: number;
  eps?: number;
  bvps?: number;
  debt_equity?: number;
  current_ratio?: number;
  gross_margin?: number;
  net_margin?: number;
}

export interface FinancialRatiosResponse {
  symbol: string;
  count: number;
  data: FinancialRatioData[];
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
  equity?: number;
  cash?: number;
  inventory?: number;
  receivables?: number;
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
  operating_expense?: number;
  operating_income?: number;
  interest_expense?: number;
  profit_before_tax?: number;
  tax_expense?: number;
  net_income?: number;
  eps?: number;
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
  free_cash_flow?: number;
  capital_expenditure?: number;
  dividends_paid?: number;
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
