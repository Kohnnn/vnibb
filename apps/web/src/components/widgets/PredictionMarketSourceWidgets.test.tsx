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

const originalFetch = global.fetch;

beforeEach(() => {
    global.fetch = jest.fn();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
});

describe('KalshiWidget', () => {
    it('renders rows when the API returns active Kalshi markets', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
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
            })),
        );

        render(<KalshiWidget />);

        expect(await screen.findByText('Will the US enter recession in 2026?')).toBeInTheDocument();
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
    it('renders a "No probability movers" message when the snapshot table is empty', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 24, count: 0, movers: [] })),
        );

        render(<PredictionMoversWidget />);

        expect(await screen.findByText(/no probability movers/i)).toBeInTheDocument();
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
