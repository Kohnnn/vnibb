/** Smoke tests for the Phase 8 prediction-market widgets. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
    localStorage.removeItem('vnibb.prediction-alerts.config');
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
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('window_hours=24'),
            { cache: 'no-store' },
        );
        expect(screen.getByRole('group', { name: 'Top movers window' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders the empty state when /movers returns nothing', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 1, count: 0, movers: [] })),
        );
        render(<TopMoversPulseWidget />);
        await waitFor(() => {
            expect(screen.getByText(/no probability movers/i)).toBeInTheDocument();
        });
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({ window_hours: 168, count: 0, movers: [] })),
        );
        fireEvent.click(screen.getByRole('button', { name: '7d' }));
        await waitFor(() => {
            expect(global.fetch).toHaveBeenLastCalledWith(
                expect.stringContaining('window_hours=168'),
                { cache: 'no-store' },
            );
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
        (global.fetch as jest.Mock).mockResolvedValue(
            new JsonTestResponse(JSON.stringify({ sources: [] })),
        );
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => {
            expect(screen.getByText(/Fed cut rates/i)).toBeInTheDocument();
            expect(screen.getByText(/5\.0pp/i)).toBeInTheDocument();
        });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('window_hours=1'),
            { cache: 'no-store' },
        );
        expect(screen.getByRole('group', { name: 'Alert window' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Last 1h' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps the last successful alerts visible and marks the feed stale after a refresh error', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                min_movement_bps: 200,
                count: 1,
                alerts: [{
                    source: 'polymarket',
                    source_id: 'p-1',
                    question: 'Will the Fed cut rates?',
                    category: 'economic',
                    url: 'https://example.com/p-1',
                    yes_price: 0.45,
                    previous_yes_price: 0.4,
                    absolute_movement: 0.05,
                    direction: 'up',
                }],
            })),
        );
        (global.fetch as jest.Mock).mockResolvedValue(new JsonTestResponse(JSON.stringify({ sources: [] })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => expect(screen.getByText(/Fed cut rates/i)).toBeInTheDocument());

        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('/prediction-markets/alerts')) return Promise.reject(new Error('offline'));
            return Promise.resolve(new JsonTestResponse(JSON.stringify({ sources: [] })));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Last 4h' }));

        await waitFor(() => {
            expect(screen.getByText(/Fed cut rates/i)).toBeInTheDocument();
            expect(screen.getByText(/Feed stale/i)).toBeInTheDocument();
        });
    });

    it('ignores an older bucket response after the selected bucket changes', async () => {
        let resolveFourHours: ((response: JsonTestResponse) => void) | undefined;
        let resolveTwentyFourHours: ((response: JsonTestResponse) => void) | undefined;
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (!url.includes('/prediction-markets/alerts')) {
                return Promise.resolve(new JsonTestResponse(JSON.stringify({ sources: [] })));
            }
            if (url.includes('window_hours=1')) {
                return Promise.resolve(new JsonTestResponse(JSON.stringify({
                    window_hours: 1,
                    alerts: [{ source: 'polymarket', source_id: 'initial', question: 'Initial alert', yes_price: 0.5, previous_yes_price: 0.4, absolute_movement: 0.1, direction: 'up' }],
                })));
            }
            if (url.includes('window_hours=4')) {
                return new Promise((resolve) => {
                    resolveFourHours = resolve;
                });
            }
            return new Promise((resolve) => {
                resolveTwentyFourHours = resolve;
            });
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => expect(screen.getByText('Initial alert')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Last 4h' }));
        await waitFor(() => expect(resolveFourHours).toBeDefined());
        fireEvent.click(screen.getByRole('button', { name: 'Last 24h' }));
        await waitFor(() => expect(resolveTwentyFourHours).toBeDefined());

        await act(async () => {
            resolveTwentyFourHours!(new JsonTestResponse(JSON.stringify({
                window_hours: 24,
                alerts: [{ source: 'kalshi', source_id: 'new', question: 'New bucket alert', yes_price: 0.5, previous_yes_price: 0.4, absolute_movement: 0.1, direction: 'up' }],
            })));
        });
        await waitFor(() => expect(screen.getByText('New bucket alert')).toBeInTheDocument());
        await act(async () => {
            resolveFourHours!(new JsonTestResponse(JSON.stringify({
                window_hours: 4,
                alerts: [{ source: 'polymarket', source_id: 'old', question: 'Old bucket alert', yes_price: 0.5, previous_yes_price: 0.4, absolute_movement: 0.1, direction: 'up' }],
            })));
        });

        expect(screen.getByText('New bucket alert')).toBeInTheDocument();
        expect(screen.queryByText('Old bucket alert')).not.toBeInTheDocument();
    });

    it('claims no movement only for an evaluated zero-alert window', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                min_movement_bps: 200,
                count: 0,
                alerts: [],
                status: 'evaluated_zero',
                coverage: {
                    eligible_markets: 4,
                    observed_markets: 4,
                    current_markets: 4,
                    evaluated_markets: 4,
                    excluded_stale_markets: 0,
                    excluded_no_baseline_markets: 0,
                },
                latest_observation_at: '2026-11-14T10:00:00+00:00',
            })),
        );
        (global.fetch as jest.Mock).mockResolvedValue(
            new JsonTestResponse(JSON.stringify({ sources: [] })),
        );
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => {
            expect(screen.getByText(/No alerts/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/No market moved more than 2pp/i)).toBeInTheDocument();
        expect(screen.getByText(/4\/4 evaluated/i)).toBeInTheDocument();
        expect(screen.getByText(/Feed loaded/i)).toBeInTheDocument();
    });

    it('reports unavailable storage instead of an empty feed', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                min_movement_bps: 200,
                count: 0,
                alerts: [],
                status: 'unavailable_storage',
                storage_available: false,
                coverage: null,
                latest_observation_at: null,
            })),
        );
        (global.fetch as jest.Mock).mockResolvedValue(
            new JsonTestResponse(JSON.stringify({ sources: [] })),
        );
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => {
            expect(screen.getByText(/Alert storage unavailable/i)).toBeInTheDocument();
        });
        expect(screen.queryByText(/No market moved more than/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/No alerts/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Feed unavailable/i)).toBeInTheDocument();
    });

    it('labels sparse coverage and shows the actual comparison interval', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify({
                window_hours: 1,
                min_movement_bps: 200,
                count: 1,
                status: 'evaluated',
                baseline_tolerance_seconds: 1800,
                latest_observation_at: '2026-11-14T10:05:00+00:00',
                coverage: {
                    eligible_markets: 3,
                    observed_markets: 3,
                    current_markets: 2,
                    evaluated_markets: 2,
                    excluded_stale_markets: 1,
                    excluded_no_baseline_markets: 0,
                },
                alerts: [{
                    source: 'polymarket',
                    source_id: 'p-1',
                    question: 'Will CPI print above 3%?',
                    category: 'economic',
                    url: null,
                    yes_price: 0.6,
                    previous_yes_price: 0.55,
                    movement: 0.05,
                    absolute_movement: 0.05,
                    direction: 'up',
                    observed_at: '2026-11-14T10:05:00+00:00',
                    baseline_at: '2026-11-14T09:00:00+00:00',
                    elapsed_seconds: 3900,
                }],
            })),
        );
        (global.fetch as jest.Mock).mockResolvedValue(
            new JsonTestResponse(JSON.stringify({ sources: [] })),
        );
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);
        await waitFor(() => {
            expect(screen.getByText(/CPI print above/i)).toBeInTheDocument();
            expect(screen.getByText(/2\/3 evaluated/i)).toBeInTheDocument();
        });
        await waitFor(() => {
            const stored: Array<{ detail?: string }> = JSON.parse(
                localStorage.getItem('vnibb-alert-activity-v1') || '[]',
            );
            expect(stored[0]?.detail).toMatch(/over 1\.1h/);
        });
    });
});