/** Smoke tests for the Phase 8 prediction-market widgets. */

import { render, screen, waitFor } from '@testing-library/react';

import { TopMoversPulseWidget } from './TopMoversPulseWidget';
import { SourceDriftWidget } from './SourceDriftWidget';
import { PredictionAlertsWidget } from './PredictionAlertsWidget';

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

describe('TopMoversPulseWidget', () => {
    it('renders rows when /movers returns movers', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                count: 2,
                movers: [
                    {
                        source: 'polymarket',
                        source_id: 'p-1',
                        question: 'Will the Fed cut rates in July?',
                        category: 'economic',
                        yes_price: 0.42,
                        previous_yes_price: 0.36,
                        absolute_movement: 0.06,
                        url: 'https://example.com/p-1',
                    },
                    {
                        source: 'kalshi',
                        source_id: 'k-1',
                        question: 'Will CPI be above 3.0% in July?',
                        category: 'economic',
                        yes_price: 0.21,
                        previous_yes_price: 0.27,
                        absolute_movement: -0.06,
                        url: 'https://example.com/k-1',
                    },
                ],
            })),
        );

        render(<TopMoversPulseWidget />);
        await waitFor(() => {
            expect(screen.getByText(/Fed cut rates/i)).toBeInTheDocument();
            expect(screen.getByText(/CPI be above 3\.0%/i)).toBeInTheDocument();
        });
    });

    it('renders the empty state when /movers returns nothing', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 1, count: 0, movers: [] })),
        );
        render(<TopMoversPulseWidget />);
        await waitFor(() => {
            expect(screen.getByText(/no probability movers/i)).toBeInTheDocument();
        });
    });
});

describe('SourceDriftWidget', () => {
    it('renders three topic tiles', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 24,
                topics: [
                    {
                        topic: 'cpi',
                        polymarket_consensus: 0.45,
                        kalshi_consensus: 0.40,
                        gap: 0.05,
                        n_polymarket: 8,
                        n_kalshi: 4,
                    },
                    {
                        topic: 'fed',
                        polymarket_consensus: 0.62,
                        kalshi_consensus: 0.6,
                        gap: 0.02,
                        n_polymarket: 12,
                        n_kalshi: 5,
                    },
                    {
                        topic: 'recession',
                        polymarket_consensus: 0.18,
                        kalshi_consensus: null,
                        gap: null,
                        n_polymarket: 4,
                        n_kalshi: 0,
                    },
                ],
            })),
        );
        render(<SourceDriftWidget />);
        await waitFor(() => {
            expect(screen.getAllByText(/Poly/i).length).toBeGreaterThan(0);
            expect(screen.getAllByText(/Kalshi/i).length).toBeGreaterThan(0);
            expect(screen.getByText('40%')).toBeInTheDocument();
            expect(screen.getByText(/Missing source data/i)).toBeInTheDocument();
        });
    });
});

describe('PredictionAlertsWidget', () => {
    it('renders up/down alert rows', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                min_movement_bps: 200,
                count: 1,
                alerts: [
                    {
                        source: 'polymarket',
                        source_id: 'p-1',
                        question: 'Will the Fed cut rates?',
                        category: 'economic',
                        url: 'https://example.com/p-1',
                        yes_price: 0.45,
                        previous_yes_price: 0.4,
                        absolute_movement: 0.05,
                        direction: 'up',
                    },
                ],
            })),
        );
        render(<PredictionAlertsWidget />);
        await waitFor(() => {
            expect(screen.getByText(/Fed cut rates/i)).toBeInTheDocument();
            expect(screen.getByText(/5\.0pp/i)).toBeInTheDocument();
        });
    });

    it('renders the empty state when no alerts', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 1, min_movement_bps: 200, count: 0, alerts: [] })),
        );
        render(<PredictionAlertsWidget />);
        await waitFor(() => {
            expect(screen.getByText(/No alerts/i)).toBeInTheDocument();
        });
    });
});