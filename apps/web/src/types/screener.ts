// Screener data types from backend API

export interface ScreenerData {
    id?: string;
    ticker: string;
    symbol?: string;
    updated_at?: string | null;

    company_name?: string;
    exchange?: string;
    industry?: string;
    price?: number;
    change_1d?: number;
    volume?: number;
    market_cap?: number;
    pe?: number;
    pb?: number;
    ps?: number;
    roe?: number;
    roa?: number;
    roic?: number;
    gross_margin?: number;
    operating_margin?: number;
    net_margin?: number;
    revenue_growth_yoy?: number;
    eps_growth_yoy?: number;
    debt_to_equity?: number;
    current_ratio?: number;
    quick_ratio?: number;
    ev_ebitda?: number;
    dividend_yield?: number;
    listing_date?: string | null;
    listing_age_days?: number | null;
    target_price?: number | null;
    target_upside_pct?: number | null;
    recommendation?: string | null;
    target_source?: string | null;
    profile_refreshed_at?: string | null;
    pass_reason?: string;

    beta?: number;
    rs_rating?: number;
    // Performance
    perf_1d?: number;
    perf_1w?: number;
    perf_1m?: number;
    perf_3m?: number;
    perf_6m?: number;
    perf_ytd?: number;
    perf_1y?: number;
    // ... legacy 84-column screener metric set

    [key: string]: unknown;
}

export interface ScreenerResponse {
    count?: number;
    exchange?: string | null;
    data: ScreenerData[];
    meta?: {
        count?: number;
        last_data_date?: string | null;
        source?: 'live' | 'cache' | 'stale_cache' | 'fallback_cache';
        cached?: boolean;
        stale?: boolean;
        fallback?: boolean;
        cache_age_seconds?: number | null;
        visible_field_coverage?: Record<string, number>;
        visible_field_values?: number;
        visible_field_possible_values?: number;
        universe?: 'ALL' | 'VN30' | 'VN100' | 'HNX30';
        membership_current?: boolean;
        membership_source?: string | null;
        membership_synced_at?: string | null;
        membership_coverage?: number;
        membership_available?: boolean;
        membership_stale?: boolean;
        discovery_coverage?: Record<string, number>;
        target_reference_note?: string;
    };
    error?: string | null;
}

export interface ScreenerColumn {
  id: string;
  label: string;
  accessor: keyof ScreenerData;
  category: 'basic' | 'valuation' | 'fundamentals' | 'technical' | 'performance';
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'percent' | 'currency' | 'change';
  sortable?: boolean;
}

export interface ColumnPreset {
  id: string;
  name: string;
  columns: string[]; // column IDs
  isDefault?: boolean;
  isCustom?: boolean;
}

export const ALL_COLUMNS: ScreenerColumn[] = [
  // Basic
  { id: 'ticker', label: 'Symbol', accessor: 'ticker', category: 'basic', align: 'left' },
  { id: 'organ_name', label: 'Company', accessor: 'organ_name' as any, category: 'basic', align: 'left', width: 200 },
  { id: 'exchange', label: 'Exchange', accessor: 'exchange', category: 'basic' },
  { id: 'industry_name', label: 'Industry', accessor: 'industry_name' as any, category: 'basic' },
  { id: 'listing_date', label: 'Listing Date', accessor: 'listing_date', category: 'basic', format: 'text' },
  { id: 'listing_age_days', label: 'Listed Days', accessor: 'listing_age_days', category: 'basic', format: 'number' },


  // Valuation
  { id: 'market_cap', label: 'Market Cap', accessor: 'market_cap', category: 'valuation', format: 'currency' },
  { id: 'pe', label: 'P/E', accessor: 'pe', category: 'valuation', format: 'number' },
  { id: 'pb', label: 'P/B', accessor: 'pb', category: 'valuation', format: 'number' },
  { id: 'ps', label: 'P/S', accessor: 'ps', category: 'valuation', format: 'number' },
  { id: 'ev_ebitda', label: 'EV/EBITDA', accessor: 'ev_ebitda', category: 'valuation', format: 'number' },
  { id: 'target_price', label: 'Target Price', accessor: 'target_price', category: 'valuation', format: 'currency' },
  { id: 'target_upside_pct', label: 'Target Upside', accessor: 'target_upside_pct', category: 'valuation', format: 'percent' },
  { id: 'recommendation', label: 'Provider Rating', accessor: 'recommendation', category: 'valuation', format: 'text' },


  // Fundamentals
  { id: 'eps', label: 'EPS', accessor: 'eps' as any, category: 'fundamentals', format: 'number' },
  { id: 'roe', label: 'ROE', accessor: 'roe', category: 'fundamentals', format: 'percent' },
  { id: 'roa', label: 'ROA', accessor: 'roa', category: 'fundamentals', format: 'percent' },
  { id: 'net_margin', label: 'Net Margin', accessor: 'net_margin', category: 'fundamentals', format: 'percent' },
  { id: 'gross_margin', label: 'Gross Margin', accessor: 'gross_margin', category: 'fundamentals', format: 'percent' },
  { id: 'dividend_yield', label: 'Div Yield', accessor: 'dividend_yield', category: 'fundamentals', format: 'percent' },
  { id: 'debt_to_equity', label: 'Debt/Eq', accessor: 'debt_to_equity', category: 'fundamentals', format: 'number' },
  { id: 'revenue_growth', label: 'Rev Growth', accessor: 'revenue_growth' as any, category: 'fundamentals', format: 'percent' },
  { id: 'earnings_growth', label: 'Earn Growth', accessor: 'earnings_growth' as any, category: 'fundamentals', format: 'percent' },
  { id: 'margin_of_safety', label: 'MoS', accessor: 'margin_of_safety' as any, category: 'valuation', format: 'percent' },
  { id: 'fcf_positive', label: 'FCF+', accessor: 'fcf_positive' as any, category: 'fundamentals', format: 'text' },
  { id: 'moat', label: 'Moat', accessor: 'moat' as any, category: 'fundamentals', format: 'text' },
  { id: 'pass_reason', label: 'Pass Reason', accessor: 'pass_reason', category: 'fundamentals', align: 'left', width: 260, format: 'text' },

  // Technical
  { id: 'rs_rating', label: 'RS Rating', accessor: 'rs_rating', category: 'technical', format: 'number' },
  { id: 'volume', label: 'Volume', accessor: 'volume', category: 'technical', format: 'number' },

  // Performance
  { id: 'price', label: 'Price', accessor: 'price', category: 'performance', format: 'currency' },
  { id: 'change_1d', label: 'Change %', accessor: 'change_1d', category: 'performance', format: 'change' },
  { id: 'perf_1w', label: '1W', accessor: 'perf_1w', category: 'performance', format: 'change' },
  { id: 'perf_1m', label: '1M', accessor: 'perf_1m', category: 'performance', format: 'change' },
  { id: 'perf_3m', label: '3M', accessor: 'perf_3m', category: 'performance', format: 'change' },
  { id: 'perf_1y', label: '1Y', accessor: 'perf_1y', category: 'performance', format: 'change' },
];

export const DEFAULT_PRESETS: ColumnPreset[] = [
  {
    id: 'overview',
    name: 'Overview',
    isDefault: true,
    columns: ['ticker', 'price', 'change_1d', 'market_cap', 'pe', 'dividend_yield'],
  },
  {
    id: 'valuation',
    name: 'Valuation',
    columns: ['ticker', 'price', 'market_cap', 'pe', 'pb', 'ps', 'ev_ebitda'],
  },
  {
    id: 'fundamentals',
    name: 'Fundamentals',
    columns: ['ticker', 'eps', 'roe', 'roa', 'net_margin'],
  },
];

