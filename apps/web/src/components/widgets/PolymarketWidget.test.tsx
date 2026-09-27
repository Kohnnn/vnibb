import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { PolymarketWidget } from './PolymarketWidget';

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
        expect(
            screen.getByRole('link', { name: 'Open Will the Fed cut rates in July?' }),
        ).toHaveAttribute('href', 'https://polymarket.com/event/fed-2026');
    });

    it('excludes synthetic odds and preserves missing outcome positions in analysis', async () => {
        global.fetch = jest.fn((input) => Promise.resolve(makeResponse(
            String(input).includes('/source-health') ? { sources: [] } :
            String(input).includes('/history') ? { points: [] } :
            String(input).includes('?search=') ? { data: [] } : {
                data: [
                    { ...backendMarketPayload.data[0], question: 'Synthetic fixture', is_synthetic: true },
                    { ...backendMarketPayload.data[1], outcomes: ['Alpha', 'Beta', 'Gamma'], outcome_prices: [0.2, null, 0.8] },
                ],
            },
        )));

        renderWithQuery(<PolymarketWidget />);
        const question = await screen.findByText('Will Vietnam qualify for the World Cup?');
        expect(screen.queryByText('Synthetic fixture')).not.toBeInTheDocument();
        fireEvent.click(question);
        const dialog = await screen.findByRole('dialog');
        const beta = within(dialog).getByText('Beta').parentElement!;
        const gamma = within(dialog).getByText('Gamma').parentElement!;
        expect(within(beta).getByText('—')).toBeInTheDocument();
        expect(within(gamma).getByText('80%')).toBeInTheDocument();
        await waitFor(() => expect(within(dialog).queryByText(/Loading recorded history/)).not.toBeInTheDocument());
    });

});