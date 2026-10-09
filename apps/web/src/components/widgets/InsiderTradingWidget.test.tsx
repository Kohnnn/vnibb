import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function sentimentResult(netValue: number | null) {
    return {
        symbol: 'MSR', period_days: 90, buy_count: 1, sell_count: 1,
        buy_value: 1_000_000, sell_value: 1_000_000, net_value: netValue,
        sentiment_score: 0, total_deals: 2,
    } as never;
}

// #109: the empty-state footer read "Net: +-" — the sign prefix was decided by
// `net_value >= 0` while the formatter rendered every falsy value as a bare '-'.
describe('InsiderTradingWidget summary footer', () => {
    beforeEach(() => {
        deals.mockResolvedValue([]);
    });

    it('renders a real zero instead of a malformed "+-" sign sequence', async () => {
        sentiment.mockResolvedValue(sentimentResult(0));

        show();

        expect(await screen.findByText('VND0')).toBeInTheDocument();
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });

    it('renders an em dash when the net value is unavailable', async () => {
        sentiment.mockResolvedValue(sentimentResult(null));

        show();

        expect(await screen.findByText('—')).toBeInTheDocument();
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });

    it('keeps the negative sign inside the formatted amount', async () => {
        sentiment.mockResolvedValue(sentimentResult(-5_000_000));

        show();

        expect(await screen.findByText('-VND5.0mn')).toBeInTheDocument();
        expect(screen.queryByText(/VND-/)).not.toBeInTheDocument();
    });

    it('prefixes the sign for a positive net value', async () => {
        sentiment.mockResolvedValue(sentimentResult(5_000_000));

        show();

        expect(await screen.findByText('+VND5.0mn')).toBeInTheDocument();
        expect(screen.queryByText(/\+-/)).not.toBeInTheDocument();
    });
});
