import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PolymarketWidget } from './PolymarketWidget';

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

        render(<PolymarketWidget />);

        expect(screen.getByText(/Loading Polymarket markets/)).toBeInTheDocument();
    });

    it('renders economic and sports rows for API data with a Synced badge', async () => {
        const fetchMock = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
                Promise.resolve(makeResponse(backendMarketPayload)),
            );
        global.fetch = fetchMock;

        render(<PolymarketWidget />);

        expect(await screen.findByText('Will the Fed cut rates in July?')).toBeInTheDocument();
        expect(screen.getByText('Will Vietnam qualify for the World Cup?')).toBeInTheDocument();
        expect(screen.getByText(/Synced/i)).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Open Will the Fed cut rates in July?' }),
        ).toHaveAttribute('href', 'https://polymarket.com/event/fed-2026');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/prediction-markets?source=polymarket'),
            { cache: 'no-store' },
        );
    });

    it('renders the empty state when the API has no markets', async () => {
        global.fetch = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
                Promise.resolve(makeResponse({ count: 0, data: [] })),
            );

        render(<PolymarketWidget />);

        expect(await screen.findByText(/No Polymarket markets available/i)).toBeInTheDocument();
    });
});