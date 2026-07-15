import { render, screen } from '@testing-library/react';

import { FreshnessBanner } from './FreshnessBanner';
import { useMarketFreshness } from '@/lib/queries';

jest.mock('@/lib/queries', () => ({
  useMarketFreshness: jest.fn(),
}));

const mockUseMarketFreshness = useMarketFreshness as jest.MockedFunction<typeof useMarketFreshness>;

function setFreshness(buckets: Array<{ label: string; status: 'fresh' | 'stale' | 'critical' | 'unknown'; age_days: number | null }>) {
  mockUseMarketFreshness.mockReturnValue({
    data: {
      timestamp: '2026-07-15T00:00:00Z',
      overall: buckets.some((bucket) => bucket.status === 'critical') ? 'critical' : 'stale',
      buckets: buckets.map((bucket) => ({ ...bucket, last_data_date: null, detail: null })),
    },
    isLoading: false,
  } as ReturnType<typeof useMarketFreshness>);
}

describe('FreshnessBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows stale and unknown buckets with amber styling', () => {
    setFreshness([
      { label: 'Prices', status: 'stale', age_days: 2 },
      { label: 'News', status: 'unknown', age_days: null },
    ]);

    render(<FreshnessBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('border-amber-500/30');
    expect(screen.getByText('Data sync delayed')).toBeInTheDocument();
    expect(screen.getByText('Prices:')).toBeInTheDocument();
    expect(screen.getByText('2 days old')).toBeInTheDocument();
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

  it('hides when every bucket is fresh', () => {
    setFreshness([{ label: 'Prices', status: 'fresh', age_days: 0 }]);

    render(<FreshnessBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
