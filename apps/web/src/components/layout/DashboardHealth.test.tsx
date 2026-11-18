import { fireEvent, render, screen, within } from '@testing-library/react';

import { DashboardHealth } from './DashboardHealth';
import { probeBackendReadiness } from '@/lib/backendHealth';
import { useMarketFreshness } from '@/lib/queries';
import type { UseQueryResult } from '@tanstack/react-query';
import type { FreshnessResponse } from '@/lib/api';

jest.mock('@/lib/backendHealth', () => ({ probeBackendReadiness: jest.fn() }));
jest.mock('@/lib/queries', () => ({
  useMarketFreshness: jest.fn(),
}));

const LOCAL_SYNC = { enabled: false, status: 'idle', loadPaused: false } as const;
const mockProbe = jest.mocked(probeBackendReadiness);
const mockUseMarketFreshness = useMarketFreshness as jest.MockedFunction<typeof useMarketFreshness>;

function setFreshness(buckets: Array<{
  label: string;
  status: 'fresh' | 'stale' | 'critical' | 'unknown';
  age_days: number | null;
  last_data_date?: string | null;
  scope?: string;
  timestamp_basis?: string;
  fetched_at?: string | null;
  raw_last_data_date?: string | null;
  settled_last_data_date?: string | null;
  reason?: 'latest_sync_unsettled' | null;
}>, isError = false) {
  mockUseMarketFreshness.mockReturnValue({
    data: {
      timestamp: '2026-07-15T00:00:00Z',
      overall: buckets.some((bucket) => bucket.status === 'critical') ? 'critical'
        : buckets.every((bucket) => bucket.status === 'fresh') ? 'fresh' : 'stale',
      buckets: buckets.map((bucket) => ({ last_data_date: null, detail: null, ...bucket })),
    },
    isLoading: false,
    isError,
  } as UseQueryResult<FreshnessResponse, Error>);
}

function openDetails() {
  const trigger = screen.getByRole('button', { name: /^Workspace health:/ });
  fireEvent.click(trigger);
  return { trigger, details: screen.getByRole('region', { name: 'Workspace health details' }) };
}

describe('DashboardHealth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockProbe.mockReset();
    // Only resolve the periodic probe in tests that assert a settled result.
    mockProbe.mockImplementation(() => new Promise(() => {}));
  });

  it('keeps dated and unknown warnings available in a focusable details region', () => {
    setFreshness([
      { label: 'Prices', status: 'stale', age_days: 2, last_data_date: '2026-07-13' },
      { label: 'News', status: 'unknown', age_days: null },
    ]);

    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    const { trigger, details } = openDetails();
    expect(details).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Prices:')).toBeInTheDocument();
    expect(screen.getByText('as of 2026-07-13 · 2 days old')).toBeInTheDocument();
    expect(screen.getByText('News:')).toBeInTheDocument();
    expect(screen.getByText('unknown age')).toBeInTheDocument();

    fireEvent.keyDown(details, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(details).not.toBeInTheDocument();
  });

  it('distinguishes current unvalidated rows from stale raw data', () => {
    setFreshness([{
      label: 'Foreign trading',
      status: 'critical',
      age_days: 33,
      raw_last_data_date: '2026-08-03',
      settled_last_data_date: '2026-07-02',
      reason: 'latest_sync_unsettled',
    }]);

    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    openDetails();
    expect(screen.getByText('current through 2026-08-03; validated through 2026-07-02')).toBeInTheDocument();
  });

  it('names observation scope and never displays crawl time as the news source date', () => {
    setFreshness([{
      label: 'Market news', status: 'critical', age_days: 17,
      last_data_date: '2026-09-21', fetched_at: '2026-10-08T03:00:00Z',
      timestamp_basis: 'published_date', scope: 'published_articles',
    }]);

    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    openDetails();
    expect(screen.getByText('Market news (published articles):')).toBeInTheDocument();
    expect(screen.getByText('as of 2026-09-21 · 17 days old')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-08/)).toHaveAttribute('datetime', '2026-10-08T03:00:00Z');
  });

  it('shows backend degradation without replacing the latest source observation', async () => {
    mockProbe.mockResolvedValue({ healthOk: true, dataOk: false });
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2, last_data_date: '2026-07-13' }]);
    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    await screen.findByRole('button', { name: 'Workspace health: Backend degraded' });
    const { details } = openDetails();
    expect(within(details).getByText('API readiness:')).toBeInTheDocument();
    expect(within(details).getByText('as of 2026-07-13 · 2 days old')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Dismiss freshness warning for this session' }));
    expect(screen.getByRole('button', { name: 'Workspace health: Backend degraded' })).toHaveFocus();
  });

  it('retains paused pull and migration details within the status disclosure', () => {
    const dismiss = jest.fn();
    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }]);
    render(<DashboardHealth
      backendSync={{ enabled: true, status: 'synced', loadPaused: true }}
      migrationNotice={{ tone: 'warning', message: 'Recovered layout', detail: 'Kept the saved workspaces.' }}
      onDismissMigrationNotice={dismiss}
    />);
    const { trigger, details } = openDetails();
    expect(within(details).getByText('Synced to the cloud')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Dismiss storage notice' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('links stale data to the source settings', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2 }]);

    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    openDetails();
    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
  });

  it('keeps dismissal for the same session and restores changed warnings', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2 }]);

    const { unmount } = render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    const dismissName = 'Dismiss freshness warning for this session';
    const { trigger, details } = openDetails();
    fireEvent.click(within(details).getByRole('button', { name: dismissName }));
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(/warning dismissed for this session/i);

    unmount();
    const { rerender } = render(<DashboardHealth backendSync={LOCAL_SYNC} />);
    expect(screen.getByRole('button', { name: 'Workspace health: Dismissed' })).toBeInTheDocument();
    const reopened = openDetails().details;
    expect(within(reopened).getByText('Prices:')).toBeInTheDocument();
    expect(within(reopened).getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
    expect(within(reopened).queryByRole('button', { name: dismissName })).not.toBeInTheDocument();

    setFreshness([{ label: 'Prices', status: 'critical', age_days: 8 }]);
    rerender(<DashboardHealth backendSync={LOCAL_SYNC} />);
    expect(screen.getByRole('button', { name: 'Workspace health: Degraded' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dismissName }));

    setFreshness([{
      label: 'Prices', status: 'critical', age_days: 8,
      reason: 'latest_sync_unsettled', raw_last_data_date: '2026-08-03',
    }]);
    rerender(<DashboardHealth backendSync={LOCAL_SYNC} />);
    openDetails();
    expect(screen.getByText('current through 2026-08-03; validated through unknown')).toBeInTheDocument();
  });

  it('updates the status slot from checking to fresh to unknown without claiming unknown data is fresh', () => {
    mockUseMarketFreshness.mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    } as UseQueryResult<FreshnessResponse, Error>);
    const { rerender } = render(<DashboardHealth backendSync={LOCAL_SYNC} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/checking data freshness/i);

    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }]);
    rerender(<DashboardHealth backendSync={LOCAL_SYNC} />);
    expect(screen.getByRole('status')).toHaveTextContent(/all tracked data sources report fresh data/i);

    setFreshness([{ label: 'Prices', status: 'unknown', age_days: null }]);
    rerender(<DashboardHealth backendSync={LOCAL_SYNC} />);
    expect(screen.getByRole('button', { name: 'Workspace health: Delayed' })).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(/report fresh data/i);
  });

  it.each([
    { data: undefined, isError: false },
    { data: undefined, isError: true },
    { data: { timestamp: '2026-07-15T00:00:00Z', overall: 'fresh', buckets: [] }, isError: false },
  ])('reports unavailable freshness when no usable report exists: %j', (state) => {
    mockUseMarketFreshness.mockReturnValue({
      ...state, isLoading: false,
    } as UseQueryResult<FreshnessResponse, Error>);
    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    expect(screen.getByRole('status')).toHaveTextContent(/freshness status unavailable/i);
    openDetails();
    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('button', { name: 'Dismiss freshness warning for this session' })).not.toBeInTheDocument();
  });

  it('does not turn zero-day non-fresh data into an unknown age', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 0, last_data_date: '2026-07-15' }]);
    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    openDetails();
    expect(screen.getByText('as of 2026-07-15 · 0 days old')).toBeInTheDocument();
  });

  it('retains last reported warnings when a refresh fails without claiming current status is known', () => {
    setFreshness([{ label: 'Prices', status: 'critical', age_days: 8, last_data_date: '2026-07-07' }], true);
    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    const { details } = openDetails();
    expect(within(details).getByText(/freshness status unavailable; last reported warnings/i)).toBeInTheDocument();
    expect(screen.getByText('as of 2026-07-07 · 8 days old')).toBeInTheDocument();
  });

  it('does not report cached fresh data as current after a refresh error', () => {
    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }], true);
    render(<DashboardHealth backendSync={LOCAL_SYNC} />);

    expect(screen.getByRole('status')).toHaveTextContent(/freshness status unavailable/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/report fresh data/i);
  });

  it('degrades instead of throwing when the payload has no buckets', () => {
    // Regression: `data.buckets.filter` threw and the route error boundary
    // replaced the whole /dashboard view.
    mockUseMarketFreshness.mockReturnValue({
      data: { timestamp: '2026-07-15T00:00:00Z', overall: 'fresh' },
      isLoading: false,
      isError: false,
    } as unknown as UseQueryResult<FreshnessResponse, Error>);

    expect(() => render(<DashboardHealth backendSync={LOCAL_SYNC} />)).not.toThrow();
    expect(screen.getByRole('status')).toHaveTextContent(/freshness status unavailable/i);
  });
});
