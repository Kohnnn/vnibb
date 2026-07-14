import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { PolymarketWidget } from './PolymarketWidget';
import { PredictionMarketSourceHealthStrip } from './PredictionMarketSourceHealthStrip';

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

class JsonTestResponse {
    readonly status: number;
    readonly ok: boolean;

    constructor(private readonly body: string, init?: ResponseInit) {
        this.status = init?.status ?? 200;
        this.ok = this.status >= 200 && this.status < 300;
    }

    async json(): Promise<unknown> {
        return JSON.parse(this.body);
    }
}

Object.defineProperty(globalThis, 'Response', { value: JsonTestResponse, configurable: true });

const makeResponse = (body: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(body), {
        status: 200,
        ...init,
    });

const backendMarketPayload = {
    count: 2,
    data: [
        {
            source: 'polymarket',
            source_id: 'fed-2026',
            question: 'Will the Fed cut rates in July?',
            category: 'economic',
            outcomes: ['Yes', 'No'],
            outcome_prices: [0.61, 0.39],
            volume: 1250000,
            liquidity: 820000,
            end_date: '2026-07-31T00:00:00Z',
            url: 'https://polymarket.com/event/fed-2026',
            active: true,
            updated_at: '2026-07-01T10:30:00Z',
        },
        {
            source: 'polymarket',
            source_id: 'world-cup-2026',
            question: 'Will Vietnam qualify for the World Cup?',
            category: 'sports',
            outcomes: ['Yes', 'No'],
            outcome_prices: [0.18, 0.82],
            volume: 640000,
            liquidity: 210000,
            end_date: '2026-08-15T00:00:00Z',
            url: 'https://polymarket.com/event/world-cup-2026',
            active: true,
            updated_at: '2026-07-01T10:30:00Z',
        },
    ],
};

describe('PolymarketWidget (v2)', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('renders loading state while the API request is pending', () => {
        const fetchMock = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() => new Promise<Response>(() => undefined));
        global.fetch = fetchMock;

        renderWithQuery(<PolymarketWidget />);

        expect(screen.getByText(/Loading Polymarket markets/)).toBeInTheDocument();
    });

    it('renders economic and sports rows with snapshot freshness', async () => {
        const fetchMock = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>((input) =>
                Promise.resolve(makeResponse(
                    String(input).includes('/source-health')
                        ? {
                              sources: [{
                                  source: 'polymarket',
                                  status: 'synced',
                                  market_count: 2,
                                  snapshot_count: 4,
                                  latest_snapshot_at: '2026-07-01T10:30:00Z',
                              }],
                          }
                        : backendMarketPayload,
                )),
            );
        global.fetch = fetchMock;

        renderWithQuery(<PolymarketWidget />);

        expect(await screen.findByText('Will the Fed cut rates in July?')).toBeInTheDocument();
        expect(screen.getByText('Will Vietnam qualify for the World Cup?')).toBeInTheDocument();
        expect(screen.getByText(/Healthy · 2 markets/i)).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Open Will the Fed cut rates in July?' }),
        ).toHaveAttribute('href', 'https://polymarket.com/event/fed-2026');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/prediction-markets?source=polymarket'),
            { cache: 'no-store' },
        );
    });

    it('forwards validated category and limit without allowing a source override', async () => {
        global.fetch = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
                Promise.resolve(makeResponse({ count: 0, data: [] })),
            );

        renderWithQuery(<PolymarketWidget config={{ category: 'economic', limit: 7, source: 'kalshi' }} />);

        await screen.findByText(/No Polymarket markets available/i);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('source=polymarket&active=true&limit=7&category=economic'),
            { cache: 'no-store' },
        );
    });

    it('renders the empty state when the API has no markets', async () => {
        global.fetch = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
                Promise.resolve(makeResponse({ count: 0, data: [] })),
            );

        renderWithQuery(<PolymarketWidget />);

        expect(await screen.findByText(/No Polymarket markets available/i)).toBeInTheDocument();
    });

    it('shares one source-health request between mounted strips', async () => {
        global.fetch = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
                Promise.resolve(makeResponse({
                    sources: [
                        { source: 'polymarket', status: 'empty', market_count: 0, snapshot_count: 0 },
                        { source: 'kalshi', status: 'stale', market_count: 4, snapshot_count: 0 },
                        { source: 'predictit', status: 'stale', market_count: 4, snapshot_count: 2 },
                        { source: 'limitless', status: 'synced', market_count: 4, snapshot_count: 2 },
                        { source: 'manifold', status: 'synced', market_count: 4, snapshot_count: 2 },
                    ],
                })),
            );

        renderWithQuery(<><PredictionMarketSourceHealthStrip /><PredictionMarketSourceHealthStrip /></>);

        await screen.findAllByText('Polymarket');
        expect(screen.getAllByText('Awaiting data')).toHaveLength(2);
        expect(screen.getAllByText('Snapshots pending')).toHaveLength(2);
        expect(screen.getAllByText('Stale')).toHaveLength(2);
        expect(screen.getAllByText('Healthy')).toHaveLength(4);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});