/** Snapshot-only smoke test for the new prediction-market family widgets. */

import { render, screen, waitFor } from '@testing-library/react';

import { KalshiWidget } from './KalshiWidget';
import { ElectionOddsWidget } from './ElectionOddsWidget';
import { PredictionMoversWidget } from './PredictionMoversWidget';
import { MacroCalibrationWidget } from './MacroCalibrationWidget';
import { ConsensusOddsWidget } from './ConsensusOddsWidget';

class JsonTestResponse {
    readonly ok: boolean;
    readonly status: number;

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

const originalFetch = global.fetch;

beforeEach(() => {
    global.fetch = jest.fn();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
});

describe('KalshiWidget', () => {
    it('renders rows and source health chips from snake_case backend fields', async () => {
        const fetchMock = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
            .mockResolvedValueOnce(makeResponse({
                count: 1,
                data: [
                    {
                        source: 'kalshi',
                        source_id: 'KXRECE-26',
                        question: 'Will the US enter recession in 2026?',
                        category: 'economic',
                        outcomes: ['Yes', 'No'],
                        outcome_prices: [0.18, 0.82],
                        volume: 15000,
                        liquidity: 7000,
                        end_date: '2026-12-31T00:00:00Z',
                        url: 'https://kalshi.com/markets/KXRECE/KXRECE-26',
                        active: true,
                        updated_at: '2026-07-01T10:30:00Z',
                    },
                ],
            }))
            .mockResolvedValueOnce(makeResponse({
                sources: [
                    {
                        source: 'polymarket',
                        status: 'synced',
                        market_count: 12,
                        snapshot_count: 34,
                        latest_snapshot_at: '2026-07-01T10:30:00Z',
                        stale_after_seconds: 3600,
                    },
                    {
                        source: 'kalshi',
                        status: 'empty',
                        market_count: 0,
                        snapshot_count: 0,
                        latest_snapshot_at: null,
                        stale_after_seconds: 3600,
                    },
                    {
                        source: 'predictit',
                        status: 'stale',
                        market_count: 3,
                        snapshot_count: 7,
                        latest_snapshot_at: '2026-06-30T10:30:00Z',
                        stale_after_seconds: 3600,
                    },
                    {
                        source: 'limitless',
                        status: 'synced',
                        market_count: 5,
                        snapshot_count: 9,
                        latest_snapshot_at: '2026-07-01T10:30:00Z',
                        stale_after_seconds: 3600,
                    },
                    {
                        source: 'manifold',
                        status: 'synced',
                        market_count: 8,
                        snapshot_count: 11,
                        latest_snapshot_at: '2026-07-01T10:30:00Z',
                        stale_after_seconds: 3600,
                    },
                ],
                stale_after_seconds: 3600,
            }));
        global.fetch = fetchMock;

        render(<KalshiWidget />);

        expect(await screen.findByText('Will the US enter recession in 2026?')).toBeInTheDocument();
        expect(await screen.findByText('Polymarket')).toBeInTheDocument();
        expect(screen.getByText('Kalshi')).toBeInTheDocument();
        expect(screen.getByText('PredictIt')).toBeInTheDocument();
        expect(screen.getByText('Limitless')).toBeInTheDocument();
        expect(screen.getByText('Manifold')).toBeInTheDocument();
        expect(screen.getByText('Awaiting data')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/prediction-markets/source-health'),
            { cache: 'no-store' },
        );
    });

    it('keeps the source health strip visible when Kalshi has no markets', async () => {
        const fetchMock = jest
            .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
            .mockResolvedValueOnce(makeResponse({ count: 0, data: [] }))
            .mockResolvedValueOnce(makeResponse({
                sources: [
                    {
                        source: 'kalshi',
                        status: 'empty',
                        market_count: 0,
                        snapshot_count: 0,
                        latest_snapshot_at: null,
                        stale_after_seconds: 3600,
                    },
                ],
                stale_after_seconds: 3600,
            }));
        global.fetch = fetchMock;

        render(<KalshiWidget />);

        expect(await screen.findByText(/No Kalshi markets available/i)).toBeInTheDocument();
        expect(await screen.findByText('Kalshi')).toBeInTheDocument();
        expect(screen.getAllByText('Awaiting data').length).toBeGreaterThan(0);
    });
});

describe('ElectionOddsWidget', () => {
    it('renders a single consensus row when both sources return markets', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(
                new JsonTestResponse(JSON.stringify({
                    count: 1,
                    data: [
                        {
                            source: 'polymarket',
                            source_id: 'us-elect-2028',
                            question: 'Who will win the 2028 US presidential election?',
                            category: 'politics',
                            outcomes: ['Democrat', 'Republican'],
                            outcome_prices: [0.55, 0.45],
                            volume: 2000,
                            liquidity: 1000,
                            end_date: '2028-11-05T00:00:00Z',
                            url: 'https://polymarket.com/event/us-elect-2028',
                            active: true,
                            updated_at: '2026-07-01T10:30:00Z',
                        },
                    ],
                })),
            )
            .mockResolvedValueOnce(
                new JsonTestResponse(JSON.stringify({ count: 0, data: [] })),
            );

        render(<ElectionOddsWidget />);

        expect(await screen.findByText(/who will win/i)).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText(/consensus/i)).toBeInTheDocument();
        });
    });
});

describe('PredictionMoversWidget', () => {
    it('renders a probability-window empty state when no movers exist', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 24, count: 0, movers: [] })),
        );

        render(<PredictionMoversWidget />);

        expect(await screen.findByText(/no probability moves in selected window/i)).toBeInTheDocument();
    });

    it('renders current, previous, and signed probability-point deltas', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 24,
                count: 2,
                movers: [
                    {
                        source: 'polymarket',
                        source_id: 'fed-cut',
                        question: 'Will the Fed cut rates in July?',
                        category: 'economic',
                        yes_price: 0.52,
                        previous_yes_price: 0.40,
                        absolute_movement: 0.12,
                        url: 'https://example.com/fed-cut',
                    },
                    {
                        source: 'kalshi',
                        source_id: 'cpi-above',
                        question: 'Will CPI be above 3.0%?',
                        category: 'economic',
                        yes_price: 0.31,
                        previous_yes_price: 0.38,
                        absolute_movement: -0.07,
                        url: 'https://example.com/cpi-above',
                    },
                ],
            })),
        );

        render(<PredictionMoversWidget />);

        expect(await screen.findByText(/Fed cut rates/i)).toBeInTheDocument();
        expect(screen.getByText('YES 52%')).toBeInTheDocument();
        expect(screen.getByText('Prev 40%')).toBeInTheDocument();
        expect(screen.getAllByText('+12.0pp').length).toBeGreaterThan(0);
        expect(screen.getByText('YES 31%')).toBeInTheDocument();
        expect(screen.getByText('Prev 38%')).toBeInTheDocument();
        expect(screen.getAllByText('-7.0pp').length).toBeGreaterThan(0);
    });
});

describe('MacroCalibrationWidget', () => {
    it('renders four calibration tiles when the composite endpoint returns a full payload', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                cpi: {
                    date: '2026-07-01',
                    n_markets: 4,
                    p10: 2.4,
                    p25: 2.8,
                    p50: 3.1,
                    p75: 3.4,
                    p90: 3.6,
                    last_updated: '2026-07-01T10:30:00Z',
                },
                fed: {
                    meetings: [
                        {
                            meeting_date: '2026-07-15',
                            p_cut: 0.20,
                            p_hold: 0.75,
                            p_hike: 0.05,
                            implied_terminal_rate: 4.75,
                        },
                    ],
                    last_updated: '2026-07-01T10:30:00Z',
                },
                recession: {
                    year: 2026,
                    p_recession: 0.22,
                    sources: [{ source: 'kalshi', source_id: 'KXRECE-26', probability: 0.22 }],
                    last_updated: '2026-07-01T10:30:00Z',
                },
                composite: {
                    read: 'CPI median 3.1% · FOMC 1 meetings · Rec 22%',
                    last_updated: '2026-07-01T10:30:00Z',
                },
                last_updated: '2026-07-01T10:30:00Z',
            })),
        );

        render(<MacroCalibrationWidget />);

        expect(await screen.findByText('CPI')).toBeInTheDocument();
        expect(screen.getByText('3.1%')).toBeInTheDocument();
        expect(screen.getByText('Recession 2026')).toBeInTheDocument();
    });
});

describe('ConsensusOddsWidget', () => {
    it('renders the empty state when neither source returns markets', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(new JsonTestResponse(JSON.stringify({ count: 0, data: [] })))
            .mockResolvedValueOnce(new JsonTestResponse(JSON.stringify({ count: 0, data: [] })));

        render(<ConsensusOddsWidget />);

        expect(await screen.findByText(/no consensus data/i)).toBeInTheDocument();
    });
});
