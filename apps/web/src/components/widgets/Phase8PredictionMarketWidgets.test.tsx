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

    const renderAlerts = async (body: Record<string, unknown>) => {
        localStorage.removeItem('vnibb-alert-activity-v1');
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            new JsonTestResponse(JSON.stringify(body)),
        );
        (global.fetch as jest.Mock).mockResolvedValue(
            new JsonTestResponse(JSON.stringify({ sources: [] })),
        );
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const onDataChange = jest.fn();
        render(
            <QueryClientProvider client={client}>
                <PredictionAlertsWidget onDataChange={onDataChange} />
            </QueryClientProvider>,
        );
        return onDataChange;
    };

    const coverage = (comparable: number, current: number, evaluated: number) => ({
        comparable_markets: comparable,
        current_markets: current,
        evaluated_markets: evaluated,
    });

    it('permits the no-movement claim only for a complete evaluated window', async () => {
        const onDataChange = await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'complete',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(4, 4, 4),
            data_observed_through: '2026-11-14T10:00:00+00:00',
        });
        await waitFor(() => {
            expect(screen.getByText(/No market moved more than 2pp/i)).toBeInTheDocument();
        });
        expect(
            screen.getByText('No market moved more than 2pp in the last 1h (4 markets evaluated).'),
        ).toBeInTheDocument();
        expect(screen.getByText(/Feed loaded/i)).toBeInTheDocument();
        const runtime = onDataChange.mock.calls.at(-1)?.[0]?.__widgetRuntime;
        expect(runtime.provenance.coverage).toBe('complete');
        expect(runtime.layoutHint.empty).toBe(true);
    });

    it('never claims no movement when coverage is incomplete', async () => {
        const onDataChange = await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'stale',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(3, 2, 2),
            data_observed_through: '2026-11-14T10:00:00+00:00',
        });
        await waitFor(() => {
            expect(screen.getByText(/Coverage incomplete/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/2 of 3 markets evaluated/i)).toBeInTheDocument();
        expect(screen.queryByText(/No market moved/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Feed stale/i)).toBeInTheDocument();
        const payload = onDataChange.mock.calls.at(-1)?.[0];
        expect(payload.__widgetRuntime.layoutHint.empty).toBe(false);
        expect(payload.__widgetRuntime.provenance.coverage).toBe('partial');
        expect(payload.feedState).toBe('stale');
        expect(payload.evaluatedMarkets).toBe(2);
        expect(payload.comparableMarkets).toBe(3);
        expect(payload.baselineToleranceSeconds).toBe(1800);
    });

    it('reports an unreadable store instead of an empty feed', async () => {
        const onDataChange = await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'unavailable',
            baseline_tolerance_seconds: 1800,
            coverage: null,
            data_observed_through: null,
        });
        await waitFor(() => {
            expect(screen.getByText(/Alerts unavailable/i)).toBeInTheDocument();
        });
        expect(screen.queryByText(/No market moved/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Feed unavailable/i)).toBeInTheDocument();
        expect(onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance.coverage).toBe('unknown');
    });

    it('distinguishes an empty store from missing history', async () => {
        await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'empty',
            coverage: coverage(0, 0, 0),
        });
        await waitFor(() => {
            expect(screen.getByText(/No intraday market observations yet/i)).toBeInTheDocument();
        });
        expect(screen.queryByText(/No market moved/i)).not.toBeInTheDocument();
    });

    it('explains a missing baseline without claiming a flat market', async () => {
        await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'no_baseline',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(0, 1, 0),
        });
        await waitFor(() => {
            expect(screen.getByText(/Not enough intraday history for the last 1h/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/within 30 min of the 1h cutoff/i)).toBeInTheDocument();
        expect(screen.queryByText(/No market moved/i)).not.toBeInTheDocument();
    });

    it('shows the measured interval and coverage evidence for a stale alert set', async () => {
        const onDataChange = await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 1,
            status: 'stale',
            baseline_tolerance_seconds: 1800,
            data_observed_through: '2026-11-14T10:05:00+00:00',
            coverage: coverage(3, 3, 1),
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
                baseline_observed_at: '2026-11-14T09:00:00+00:00',
                current_observed_at: '2026-11-14T10:05:00+00:00',
                elapsed_seconds: 3900,
            }],
        });
        await waitFor(() => {
            expect(screen.getByText(/CPI print above/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/1\/3 markets evaluated/i)).toBeInTheDocument();
        expect(screen.getByText(/over 1\.1h/i)).toBeInTheDocument();
        const payload = onDataChange.mock.calls.at(-1)?.[0];
        expect(payload.__widgetRuntime.provenance.updatedAt).toBe('2026-11-14T10:05:00+00:00');
        await waitFor(() => {
            const stored: Array<{ detail?: string; triggerTime?: string }> = JSON.parse(
                localStorage.getItem('vnibb-alert-activity-v1') || '[]',
            );
            expect(stored[0]?.detail).toMatch(/over 1\.08h \(window 1h\)/);
            expect(stored[0]?.triggerTime).toBe('2026-11-14T10:05:00+00:00');
        });
    });

    it('keeps distinct activity records for the same move in two windows', async () => {
        const alertAt = (windowHours: number, elapsedSeconds: number) => ({
            window_hours: windowHours, min_movement_bps: 200, count: 1,
            status: 'complete',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(1, 1, 1),
            alerts: [{
                source: 'polymarket', source_id: 'same', question: 'Identical move?',
                category: null, url: null, yes_price: 0.7, previous_yes_price: 0.5,
                movement: 0.2, absolute_movement: 0.2, direction: 'up',
                baseline_observed_at: '2026-11-14T06:00:00+00:00',
                // Same current observation and same movement, different window.
                current_observed_at: '2026-11-14T10:00:00+00:00',
                elapsed_seconds: elapsedSeconds,
            }],
        });
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (!url.includes('/prediction-markets/alerts')) {
                return Promise.resolve(new JsonTestResponse(JSON.stringify({ sources: [] })));
            }
            return Promise.resolve(new JsonTestResponse(JSON.stringify(
                url.includes('window_hours=4') ? alertAt(4, 14_400) : alertAt(1, 3_600),
            )));
        });
        localStorage.removeItem('vnibb-alert-activity-v1');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><PredictionAlertsWidget /></QueryClientProvider>);

        await waitFor(() => {
            expect(screen.getByText(/over 1\.0h/i)).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Last 4h' }));
        await waitFor(() => {
            expect(screen.getByText(/over 4\.0h/i)).toBeInTheDocument();
        });

        const stored: Array<{ detail?: string }> = JSON.parse(
            localStorage.getItem('vnibb-alert-activity-v1') || '[]',
        );
        // Both comparisons survive: a shared ID would drop the second, leaving
        // only one window's interval evidence in the bell.
        expect(stored).toHaveLength(2);
        const details = stored.map((item) => item.detail).join('\n');
        expect(details).toMatch(/over 1\.00h \(window 1h\)/);
        expect(details).toMatch(/over 4\.00h \(window 4h\)/);
    });

    it('records the stale subset qualifier in bell activity', async () => {
        await renderAlerts({
            window_hours: 1, min_movement_bps: 200, count: 1,
            status: 'stale',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(3, 3, 1),
            alerts: [{
                source: 'polymarket', source_id: 'p-1', question: 'Partial coverage?',
                category: null, url: null, yes_price: 0.6, previous_yes_price: 0.55,
                movement: 0.05, absolute_movement: 0.05, direction: 'up',
                baseline_observed_at: '2026-11-14T09:00:00+00:00',
                current_observed_at: '2026-11-14T10:05:00+00:00',
                elapsed_seconds: 3900,
            }],
        });
        await waitFor(() => {
            expect(screen.getByText(/Partial coverage\?/i)).toBeInTheDocument();
        });
        await waitFor(() => {
            const stored: Array<{ detail?: string }> = JSON.parse(
                localStorage.getItem('vnibb-alert-activity-v1') || '[]',
            );
            expect(stored[0]?.detail).toMatch(
                /coverage incomplete \(1 of 3 markets evaluated, status stale\)/,
            );
            expect(stored[0]?.detail).not.toMatch(/No market moved/);
        });
    });

    it('withdraws a no-movement claim when revalidation fails', async () => {
        localStorage.removeItem('vnibb-alert-activity-v1');
        const complete = {
            window_hours: 1, min_movement_bps: 200, count: 0, alerts: [],
            status: 'complete',
            baseline_tolerance_seconds: 1800,
            coverage: coverage(4, 4, 4),
            data_observed_through: '2026-11-14T10:00:00+00:00',
        };
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('/prediction-markets/alerts')) {
                if (url.includes('window_hours=4')) return Promise.reject(new Error('store refused'));
                return Promise.resolve(new JsonTestResponse(JSON.stringify(complete)));
            }
            return Promise.resolve(new JsonTestResponse(JSON.stringify({ sources: [] })));
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const onDataChange = jest.fn();
        render(
            <QueryClientProvider client={client}>
                <PredictionAlertsWidget onDataChange={onDataChange} />
            </QueryClientProvider>,
        );
        await waitFor(() => {
            expect(screen.getByText(/No market moved more than 2pp/i)).toBeInTheDocument();
        });
        expect(onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime.layoutHint.empty).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Last 4h' }));
        await waitFor(() => {
            expect(screen.getByText(/Coverage unverified/i)).toBeInTheDocument();
        });
        // The previous window evaluated cleanly, but its result is no longer
        // current: a failed revalidation must retract the conclusion and the
        // compact tile rather than leave the last verdict standing.
        expect(screen.queryByText(/No market moved/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Feed stale/i)).toBeInTheDocument();
        // The retained payload is the 1h evaluation, so the header names both
        // windows instead of presenting 1h numbers under a 4h selection.
        expect(screen.getByText(/requested 4h; retaining last 1h evaluation/i)).toBeInTheDocument();
        const payload = onDataChange.mock.calls.at(-1)?.[0];
        expect(payload.feedState).toBe('stale');
        expect(payload.__widgetRuntime.layoutHint.empty).toBe(false);
        expect(payload.__widgetRuntime.provenance.coverage).not.toBe('complete');
    });
});
