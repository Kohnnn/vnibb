import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InsiderSentiment, InsiderTrade } from '@/types/insider';
import { InsiderTradingWidget } from './InsiderTradingWidget';
import { getInsiderDeals, getInsiderSentiment } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    getInsiderDeals: jest.fn(),
    getInsiderSentiment: jest.fn(),
}));

const deals = jest.mocked(getInsiderDeals);
const sentiment = jest.mocked(getInsiderSentiment);

function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry:false } } });
    return render(
        <QueryClientProvider client={client}>
            <InsiderTradingWidget symbol="MSR" />
        </QueryClientProvider>
    );
}

function admittedDeal(overrides: Partial<InsiderTrade> = {}): InsiderTrade {
    return {
        id: 1, symbol: 'MSR', insider_name: 'Nguyen Van A', insider_position: 'CEO',
        deal_action: 'BUY', deal_quantity: 100, deal_price: 10_000, deal_value: 1_000_000,
        price_unit: 'VND', value_unit: 'VND', announce_date: '2026-01-05',
        ...overrides,
    };
}

// Mirrors the backend's admitted window aggregate: every classified deal in the
// 90-day window carries finite value plus VND evidence, so `value_unit` is set.
function sentimentResult(overrides: Partial<InsiderSentiment> = {}): InsiderSentiment {
    return {
        symbol: 'MSR', period_days: 90, buy_count: 1, sell_count: 1,
        buy_value: 1_000_000, sell_value: 1_000_000, net_value: 0,
        sentiment_score: 0, total_deals: 2, value_unit: 'VND',
        ...overrides,
    };
}

// A window with one unadmitted classified row: money and score are withheld as a
// set while the counts stay accurate.
function withheldResult(overrides: Partial<InsiderSentiment> = {}): InsiderSentiment {
    return {
        symbol: 'MSR', period_days: 90, buy_count: 3, sell_count: 1,
        buy_value: null, sell_value: null, net_value: null,
        sentiment_score: null, total_deals: 5, value_unit: null,
        ...overrides,
    };
}

// #109: the footer printed "Net: +-" because the sign prefix was decided from
// `net_value >= 0` while this formatter rendered every falsy value as '-'.
// Unavailable is now an em dash, zero is a real zero, and negatives keep the
// sign inside the formatted amount instead of collapsing into "VND-…".
describe('InsiderTradingWidget summary footer', () => {
    beforeEach(() => {
        deals.mockResolvedValue([admittedDeal()]);
    });

    it('renders a real zero instead of a malformed "+-" sign sequence', async () => {
        sentiment.mockResolvedValue(sentimentResult({ net_value: 0 }));

        show();

        expect(await screen.findByText('VND0')).toBeInTheDocument();
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });

    it('renders an em dash when the net value is unavailable', async () => {
        sentiment.mockResolvedValue(withheldResult());

        show();

        expect((await screen.findAllByText('—')).length).toBeGreaterThan(0);
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });

    it('keeps the negative sign inside the formatted amount', async () => {
        sentiment.mockResolvedValue(sentimentResult({ net_value: -5_000_000, sentiment_score: -50 }));

        show();

        expect(await screen.findByText('-VND5.0mn')).toBeInTheDocument();
        expect(screen.queryByText(/VND-/)).not.toBeInTheDocument();
    });

    it('prefixes the sign for a positive net value', async () => {
        sentiment.mockResolvedValue(sentimentResult({ net_value: 5_000_000, sentiment_score: 50 }));

        show();

        expect(await screen.findByText('+VND5.0mn')).toBeInTheDocument();
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });
});

// The deals feed is a separate undated 20-row list, so it can never certify the
// 90-day aggregate. The aggregate's own `value_unit` and nullability decide what
// renders: no unit evidence means withheld money, never a size-based VND guess.
describe('InsiderTradingWidget aggregate unit admission', () => {
    it('renders both money totals from an admitted VND window aggregate', async () => {
        deals.mockResolvedValue([admittedDeal()]);
        sentiment.mockResolvedValue(sentimentResult({
            buy_value: 1_500_000, sell_value: 250_000, net_value: 1_250_000,
            sentiment_score: 71.42857142857143, buy_count: 3, sell_count: 1, total_deals: 5,
        }));

        show();

        expect(await screen.findByText('Buy:')).toBeInTheDocument();
        expect(screen.getByText('Buy:').parentElement?.textContent).toBe('Buy:VND1.5mn');
        expect(screen.getByText('Sell:').parentElement?.textContent).toBe('Sell:VND250.0k');
        expect(screen.getByText('Net:').parentElement?.textContent).toBe('Net:+VND1.3mn');
        expect(screen.getByText(/5 deals reported in 90d window/)).toBeInTheDocument();
    });

    it('withholds the aggregate when the window is not fully VND-admitted', async () => {
        // No row carries VND evidence, so no size-based amount can appear either.
        deals.mockResolvedValue([admittedDeal({ value_unit: 'unknown', price_unit: 'unknown' })]);
        sentiment.mockResolvedValue(withheldResult());

        show();

        expect(await screen.findByText('Buy:')).toBeInTheDocument();
        for (const label of ['Buy:', 'Sell:', 'Net:']) {
            expect(screen.getByText(label).parentElement?.textContent).toBe(`${label}—`);
        }
        // Counts survive withholding: an unknown unit is not an unknown count.
        expect(screen.getByText(/Money withheld/)).toBeInTheDocument();
        expect(screen.getByText(/3 · Sell 1 · 5 deals/)).toBeInTheDocument();
    });

    it('withholds totals when a deployed response omits unit evidence entirely', async () => {
        // Older production payloads predate `value_unit`; the widget must not
        // infer VND from absent fields, so money stays unavailable until the
        // aggregate declares its own unit.
        deals.mockResolvedValue([admittedDeal({ value_unit: 'unknown', price_unit: 'unknown' })]);
        sentiment.mockResolvedValue({
            symbol: 'MSR', period_days: 90, buy_count: 1, sell_count: 1,
            buy_value: 1_000_000, sell_value: 1_000_000, net_value: 0,
            sentiment_score: 0, total_deals: 2,
        } as InsiderSentiment);

        show();

        expect(await screen.findByText('Buy:')).toBeInTheDocument();
        for (const label of ['Buy:', 'Sell:', 'Net:']) {
            expect(screen.getByText(label).parentElement?.textContent).toBe(`${label}—`);
        }
    });

    it('keeps a genuine admitted VND zero instead of reading it as absence', async () => {
        deals.mockResolvedValue([admittedDeal({ deal_value: 0 })]);
        sentiment.mockResolvedValue(sentimentResult({ buy_value: 0, sell_value: 0, net_value: 0, sentiment_score: 0 }));

        show();

        expect((await screen.findAllByText('VND0')).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Money withheld/)).not.toBeInTheDocument();
    });

    it('keeps row-level unit admission independent of the withheld aggregate', async () => {
        deals.mockResolvedValue([
            admittedDeal(),
            admittedDeal({ id: 2, value_unit: 'unknown', price_unit: 'unknown' }),
        ]);
        sentiment.mockResolvedValue(withheldResult());

        show();

        // The window aggregate is withheld, yet the admitted row still shows its
        // own VND amount and the unadmitted row stays an em dash: per-row
        // evidence is not a window denominator.
        expect(await screen.findAllByText('BUY')).toHaveLength(2);
        expect(screen.getByText('VND1.0mn')).toBeInTheDocument();
        expect(screen.getByText('Buy:').parentElement?.textContent).toBe('Buy:—');
    });
});
