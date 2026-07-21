import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ForeignFlowLeaderboardWidget } from './ForeignFlowLeaderboardWidget';
import { WatchlistLimitsMonitorWidget, classifyLimit } from './WatchlistLimitsMonitorWidget';
import { useForeignFlowLeaderboard, useMarketFreshness, usePriceBoard } from '@/lib/queries';

jest.mock('@/lib/queries', () => ({ useForeignFlowLeaderboard: jest.fn(), useMarketFreshness: jest.fn(), usePriceBoard: jest.fn() }));

const dashboardState = { dashboards: [] as Array<Record<string, unknown>> };

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: () => ({ state: dashboardState }) }));

const setLinkedSymbol = jest.fn();

jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol }) }));
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children, title }: { children: ReactNode; title: string }) => <section><h2>{title}</h2>{children}</section> }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: ({ sourceLabel, updatedAt, note }: { sourceLabel?: string; updatedAt?: string | number; note?: string }) => <div>{sourceLabel}|{String(updatedAt)}|{note}</div> }));
jest.mock('@/components/ui/widget-skeleton', () => ({ WidgetSkeleton: () => <div>Loading</div> }));
jest.mock('@/components/ui/widget-states', () => ({ WidgetEmpty: ({ message, detail }: { message: string; detail?: string }) => <div>{message}{detail}</div>, WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div> }));

const foreignQuery = jest.mocked(useForeignFlowLeaderboard);
const freshnessQuery = jest.mocked(useMarketFreshness);
const priceBoardQuery = jest.mocked(usePriceBoard);
const baseQuery = { isLoading: false, error: null, refetch: jest.fn(), isFetching: false, dataUpdatedAt: 0 };

describe('Wave 4 widgets', () => {
  beforeEach(() => {
    setLinkedSymbol.mockReset();
    dashboardState.dashboards = [];
    foreignQuery.mockReturnValue({ ...baseQuery, data: { trade_date: '2026-01-02', requested_metric: 'net_volume', requested_window: '1D', metric_unit: 'shares', available_settlement_dates: 1, window_coverage: '1/1 settlement dates', settlement_dates: ['2026-01-02'], source: 'VNIBB stored foreign_trading', source_precedence: ['completed daily_trading sync', 'foreign_trading.net_volume'], freshness: 'Settlement end 2026-01-02', fallback_used: false, universe_symbols: 4, symbols_covered: 3, symbols_unavailable: 1, available_fields: ['net_volume'], breadth: { positive: 1, negative: 1, flat: 1 }, top_net_buy: [{ symbol: 'BUY', net_volume: 300, net_value: null, observations: 1, settlement_dates: ['2026-01-02'] }], top_net_sell: [{ symbol: 'SELL', net_volume: -200, net_value: null, observations: 1, settlement_dates: ['2026-01-02'] }] } } as unknown as ReturnType<typeof useForeignFlowLeaderboard>);
    freshnessQuery.mockReturnValue({ ...baseQuery, data: { timestamp: '2026-01-02T09:00:00Z', overall: 'fresh', buckets: [{ label: 'Foreign trading', last_data_date: '2026-01-02', age_days: 0, status: 'fresh', detail: 'Stored observations' }] } } as unknown as ReturnType<typeof useMarketFreshness>);
    priceBoardQuery.mockReturnValue({ ...baseQuery, data: { count: 3, data: [{ symbol: 'CEIL', price: 12, ceiling: 12, floor: 10, bestBidVol: 20, bestAskVol: 10, source: 'KBS', refreshedAt: '2026-01-02T09:00:00Z' }, { symbol: 'FLOOR', price: 10, ceiling: 12, floor: 10, source: 'KBS', refreshedAt: '2026-01-02T09:00:00Z' }, { symbol: 'NONE', price: 11, ceiling: null, floor: null, source: 'KBS', refreshedAt: '2026-01-02T09:00:00Z' }] } } as unknown as ReturnType<typeof usePriceBoard>);
  });

  it('renders settlement ranking, exports displayed rows, and links foreign-flow symbols', () => {
    const onDataChange = jest.fn();
    render(<ForeignFlowLeaderboardWidget id="foreign" widgetGroup="A" onDataChange={onDataChange} />);
    expect(screen.getByText(/Settlement end 2026-01-02/)).toBeInTheDocument();
    expect(screen.getByText(/3\/4 available · 1 unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Fields: net volume · Source fresh')).toBeInTheDocument();
    expect(screen.getByText('Observed volume/value flow is not ownership, allocation, or investor intent.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Foreign-flow metric' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Foreign-flow settlement window' })).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({
        exportData: [
          expect.objectContaining({ symbol: 'BUY' }),
          expect.objectContaining({ symbol: 'SELL' }),
        ],
      }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Net value' }));
    expect(foreignQuery).toHaveBeenLastCalledWith({ metric: 'net_value', window: '1D' });
    fireEvent.click(screen.getByRole('button', { name: '5D' }));
    expect(foreignQuery).toHaveBeenLastCalledWith({ metric: 'net_value', window: '5D' });
    fireEvent.click(screen.getByRole('button', { name: /BUY/ }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('BUY');
  });

  it('discloses partial settlement coverage and unavailable source health', () => {
    foreignQuery.mockReturnValue({ ...baseQuery, data: { trade_date: '2026-01-02', requested_metric: 'net_value', requested_window: '5D', metric_unit: 'provider_native_value', available_settlement_dates: 2, window_coverage: '2/5 settlement dates', settlement_dates: ['2026-01-02', '2026-01-01'], source: 'VNIBB stored foreign_trading', source_precedence: ['completed daily_trading sync', 'foreign_trading.net_value'], freshness: 'Settlement end 2026-01-02', fallback_used: false, universe_symbols: 2, symbols_covered: 0, symbols_unavailable: 2, available_fields: [], breadth: { positive: 0, negative: 0, flat: 0 }, top_net_buy: [], top_net_sell: [] } } as unknown as ReturnType<typeof useForeignFlowLeaderboard>);
    freshnessQuery.mockReturnValue({ ...baseQuery, data: { timestamp: '2026-01-02T09:00:00Z', overall: 'stale', buckets: [{ label: 'Daily prices', last_data_date: '2026-01-02', age_days: 0, status: 'fresh', detail: null }] } } as unknown as ReturnType<typeof useMarketFreshness>);

    render(<ForeignFlowLeaderboardWidget id="foreign" />);
    fireEvent.click(screen.getByRole('button', { name: '5D' }));

    expect(screen.getByText('provider value units · 2/5 settlement dates · partial')).toBeInTheDocument();
    expect(screen.getByText('Fields: unavailable · Freshness unavailable')).toBeInTheDocument();
    expect(screen.getByText(/absent or non-finite metrics are unavailable, not zero/)).toBeInTheDocument();
  });

  it('keeps covered all-flat flow distinct from unavailable data', () => {
    const onDataChange = jest.fn();
    foreignQuery.mockReturnValue({ ...baseQuery, data: { trade_date: '2026-01-02', requested_metric: 'net_volume', requested_window: '1D', metric_unit: 'shares', available_settlement_dates: 1, window_coverage: '1/1 settlement dates', settlement_dates: ['2026-01-02'], source: 'VNIBB stored foreign_trading', source_precedence: ['completed daily_trading sync', 'foreign_trading.net_volume'], freshness: 'Settlement end 2026-01-02', fallback_used: false, universe_symbols: 3, symbols_covered: 3, symbols_unavailable: 0, available_fields: ['net_volume'], breadth: { positive: 0, negative: 0, flat: 3 }, top_net_buy: [], top_net_sell: [] } } as unknown as ReturnType<typeof useForeignFlowLeaderboard>);

    render(<ForeignFlowLeaderboardWidget id="foreign" onDataChange={onDataChange} />);

    expect(screen.getByText(/No net inflow or outflow in this window3 covered symbols had flat observed flow/)).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({
        layoutHint: expect.objectContaining({ empty: false }),
        exportData: [],
      }),
    }));
  });

  it('distinguishes stale source health from unavailable health', () => {
    freshnessQuery.mockReturnValue({ ...baseQuery, data: { timestamp: '2026-01-02T09:00:00Z', overall: 'critical', buckets: [{ label: 'Foreign trading', last_data_date: '2025-12-20', age_days: 13, status: 'critical', detail: 'Behind' }] } } as unknown as ReturnType<typeof useMarketFreshness>);

    render(<ForeignFlowLeaderboardWidget id="foreign" />);

    expect(screen.getByText('Fields: net volume · Source critical')).toBeInTheDocument();
  });

  it('combines dashboard and manual symbols in source order, deduplicates, caps, and reports counts', () => {
    const dashboardSymbols = Array.from({ length: 49 }, (_, index) => `D${index.toString().padStart(2, '0')}`);
    dashboardState.dashboards = [{ id: 'dashboard', tabs: [{ id: 'tab', widgets: [{ type: 'watchlist', config: { watchlistSymbols: [...dashboardSymbols, ' shr '] } }] }] }];
    const manualSymbols = ['SHR', 'MNL', 'OVR'];
    render(<WatchlistLimitsMonitorWidget id="limits" widgetGroup="A" config={{ watchlistSymbols: manualSymbols }} />);
    const expected = [...dashboardSymbols, 'SHR'];
    expect(priceBoardQuery).toHaveBeenCalledWith(expected, { enabled: true });
    expect(screen.getByText('KBS|2026-01-02T09:00:00Z|Dashboard 50 · Manual 3 · Deduplicated 52 · Capped 2 · Query 50/50')).toBeInTheDocument();
    expect(screen.getByText('At ceiling')).toBeInTheDocument();
    expect(screen.getByText('At floor')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /CEIL/ }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('CEIL');
  });

  it('normalizes only valid provider limits', () => {
    expect(classifyLimit({ symbol: 'A', price: 11, floor: 10, ceiling: 12 })).toEqual({ status: 'Inside range', distance: 0.5 });
    expect(classifyLimit({ symbol: 'A', price: 11, floor: null, ceiling: 12 })).toEqual({ status: 'Unavailable', distance: null });
  });
});
