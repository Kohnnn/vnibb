import { fireEvent, render, screen } from '@testing-library/react';

import { FreshnessBanner } from './FreshnessBanner';
import { useMarketFreshness } from '@/lib/queries';
import type { UseQueryResult } from '@tanstack/react-query';
import type { FreshnessResponse } from '@/lib/api';

jest.mock('@/lib/queries', () => ({
  useMarketFreshness: jest.fn(),
}));

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

describe('FreshnessBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('keeps dated and unknown warnings available in a focusable details region', () => {
    setFreshness([
      { label: 'Prices', status: 'stale', age_days: 2, last_data_date: '2026-07-13' },
      { label: 'News', status: 'unknown', age_days: null },
    ]);

    render(<FreshnessBanner />);

    const details = screen.getByRole('region', { name: 'Data freshness details' });
    details.focus();
    expect(details).toHaveFocus();
    expect(screen.getByText('Prices:')).toBeInTheDocument();
    expect(screen.getByText('as of 2026-07-13 · 2 days old')).toBeInTheDocument();
    expect(screen.getByText('News:')).toBeInTheDocument();
    expect(screen.getByText('unknown age')).toBeInTheDocument();
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

    render(<FreshnessBanner />);

    expect(screen.getByText('current through 2026-08-03; validated through 2026-07-02')).toBeInTheDocument();
  });

  it('names observation scope and never displays crawl time as the news source date', () => {
    setFreshness([{
      label: 'Market news', status: 'critical', age_days: 17,
      last_data_date: '2026-09-21', fetched_at: '2026-10-08T03:00:00Z',
      timestamp_basis: 'published_date', scope: 'published_articles',
    }]);

    render(<FreshnessBanner />);

    expect(screen.getByText('Market news (published articles):')).toBeInTheDocument();
    expect(screen.getByText('as of 2026-09-21 · 17 days old')).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-08/)).not.toBeInTheDocument();
  });

  it('links stale data to the source settings', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2 }]);

    render(<FreshnessBanner />);

    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
  });

  it('keeps dismissal for the same session and restores changed warnings', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2 }]);

    const { unmount } = render(<FreshnessBanner />);

    const dismissButton = screen.getByRole('button', { name: 'Dismiss banner for this session' });
    fireEvent.click(dismissButton);
    expect(screen.queryByText('Prices:')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/warning dismissed for this session/i);
    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');

    unmount();
    const { rerender } = render(<FreshnessBanner />);
    expect(screen.queryByRole('button', { name: 'Dismiss banner for this session' })).not.toBeInTheDocument();

    setFreshness([{ label: 'Prices', status: 'critical', age_days: 8 }]);
    rerender(<FreshnessBanner />);
    expect(screen.getByText('Prices:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner for this session' }));

    setFreshness([{
      label: 'Prices', status: 'critical', age_days: 8,
      reason: 'latest_sync_unsettled', raw_last_data_date: '2026-08-03',
    }]);
    rerender(<FreshnessBanner />);
    expect(screen.getByText('current through 2026-08-03; validated through unknown')).toBeInTheDocument();
  });

  it('updates the status slot from checking to fresh to unknown without claiming unknown data is fresh', () => {
    mockUseMarketFreshness.mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    } as UseQueryResult<FreshnessResponse, Error>);
    const { rerender } = render(<FreshnessBanner />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/checking data freshness/i);

    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }]);
    rerender(<FreshnessBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/all tracked data sources report fresh data/i);

    setFreshness([{ label: 'Prices', status: 'unknown', age_days: null }]);
    rerender(<FreshnessBanner />);
    expect(screen.getByText('unknown age')).toBeInTheDocument();
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
    render(<FreshnessBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(/freshness status unavailable/i);
    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('button', { name: 'Dismiss banner for this session' })).not.toBeInTheDocument();
  });

  it('does not turn zero-day non-fresh data into an unknown age', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 0, last_data_date: '2026-07-15' }]);
    render(<FreshnessBanner />);

    expect(screen.getByText('as of 2026-07-15 · 0 days old')).toBeInTheDocument();
  });

  it('retains last reported warnings when a refresh fails without claiming current status is known', () => {
    setFreshness([{ label: 'Prices', status: 'critical', age_days: 8, last_data_date: '2026-07-07' }], true);
    render(<FreshnessBanner />);

    expect(screen.getByText(/freshness status unavailable; last reported warnings/i)).toBeInTheDocument();
    expect(screen.getByText('as of 2026-07-07 · 8 days old')).toBeInTheDocument();
  });

  it('does not report cached fresh data as current after a refresh error', () => {
    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }], true);
    render(<FreshnessBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(/freshness status unavailable/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/report fresh data/i);
  });
});
