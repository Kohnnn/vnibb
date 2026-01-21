// Shared stock data for ticker search/combobox components

export interface StockInfo {
    symbol: string;
    name: string;
    industry: string;
    exchange: 'HOSE' | 'HNX' | 'UPCOM';
    type: 'STOCK' | 'ETF' | 'FUND';
}

// Popular Vietnam stocks with exchange info
export const POPULAR_STOCKS: StockInfo[] = [
    { symbol: 'VNM', name: 'Vinamilk', industry: 'Food & Beverage', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'FPT', name: 'FPT Corporation', industry: 'Technology', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VIC', name: 'Vingroup', industry: 'Real Estate', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'HPG', name: 'Hoa Phat Group', industry: 'Steel', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VHM', name: 'Vinhomes', industry: 'Real Estate', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'MSN', name: 'Masan Group', industry: 'Consumer Goods', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'TCB', name: 'Techcombank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VCB', name: 'Vietcombank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'MWG', name: 'Mobile World', industry: 'Retail', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VRE', name: 'Vincom Retail', industry: 'Retail', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VJC', name: 'Vietjet Air', industry: 'Aviation', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'SAB', name: 'Sabeco', industry: 'Beverages', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'GAS', name: 'PV Gas', industry: 'Energy', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'PLX', name: 'Petrolimex', industry: 'Energy', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VPB', name: 'VPBank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'MBB', name: 'MB Bank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'ACB', name: 'Asia Commercial Bank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'SSI', name: 'SSI Securities', industry: 'Securities', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'VND', name: 'VNDirect Securities', industry: 'Securities', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'HDB', name: 'HD Bank', industry: 'Banking', exchange: 'HOSE', type: 'STOCK' },
    { symbol: 'E1VFVN30', name: 'VN30 ETF', industry: 'ETF', exchange: 'HOSE', type: 'ETF' },
    { symbol: 'FUEVFVND', name: 'VN Diamond ETF', industry: 'ETF', exchange: 'HOSE', type: 'ETF' },
    { symbol: 'SHB', name: 'SHB Bank', industry: 'Banking', exchange: 'HNX', type: 'STOCK' },
    { symbol: 'PVS', name: 'PV Technical Services', industry: 'Energy', exchange: 'HNX', type: 'STOCK' },
];

// Search function for filtering stocks
export function searchStocks(query: string, limit: number = 10): StockInfo[] {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
        return POPULAR_STOCKS.slice(0, limit);
    }

    return POPULAR_STOCKS
        .filter(stock =>
            stock.symbol.toLowerCase().includes(lowerQuery) ||
            stock.name.toLowerCase().includes(lowerQuery)
        )
        .slice(0, limit);
}
