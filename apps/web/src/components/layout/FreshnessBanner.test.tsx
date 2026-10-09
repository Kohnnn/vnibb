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
}>) {
  mockUseMarketFreshness.mockReturnValue({
    data: {
      timestamp: '2026-07-15T00:00:00Z',
      overall: buckets.some((bucket) => bucket.status === 'critical') ? 'critical' : 'stale',
      buckets: buckets.map((bucket) => ({ last_data_date: null, detail: null, ...bucket })),
    },
    isLoading: false,
  } as UseQueryResult<FreshnessResponse, Error>);
}

describe('FreshnessBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows stale and unknown buckets with amber styling', () => {
    setFreshness([
      { label: 'Prices', status: 'stale', age_days: 2, last_data_date: '2026-07-13' },
      { label: 'News', status: 'unknown', age_days: null },
    ]);

    render(<FreshnessBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('border-amber-500/30');
    expect(screen.getByText('Data sync delayed')).toBeInTheDocument();
    expect(screen.getByText('Prices:')).toBeInTheDocument();
    expect(screen.getByText('as of 2026-07-13 · 2 days old')).toBeInTheDocument();
    expect(screen.getByText('News:')).toBeInTheDocument();
    expect(screen.getByText('unknown age')).toBeInTheDocument();
  });

  it('uses the critical message and rose styling when a bucket is critical', () => {
    setFreshness([{ label: 'Prices', status: 'critical', age_days: 8 }]);

    render(<FreshnessBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('border-rose-500/30');
    expect(screen.getByText('Data sync degraded')).toBeInTheDocument();
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

    expect(screen.getByText('Data validation degraded')).toBeInTheDocument();
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

  it('dismisses through an accessible 44px touch target', () => {
    setFreshness([{ label: 'Prices', status: 'stale', age_days: 2 }]);

    render(<FreshnessBanner />);

    const dismissButton = screen.getByRole('button', { name: 'Dismiss banner for this session' });
    expect(dismissButton).toHaveClass('h-11', 'w-11');
    fireEvent.click(dismissButton);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides when every bucket is fresh', () => {
    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }]);

    render(<FreshnessBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
