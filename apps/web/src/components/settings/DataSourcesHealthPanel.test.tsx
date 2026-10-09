import { render, screen, within } from '@testing-library/react';
import { DataSourcesHealthPanel } from './DataSourcesHealthPanel';
import { useDataSourcesFreshness } from '@/lib/queries';
import type { UseQueryResult } from '@tanstack/react-query';
import type { DataSourcesFreshnessResponse } from '@/lib/api';

jest.mock('@/lib/queries', () => ({ useDataSourcesFreshness: jest.fn() }));
const query = jest.mocked(useDataSourcesFreshness);

it('names source timestamp basis and separates recent crawl from unknown publication', () => {
  query.mockReturnValue({
    data: {
      timestamp: '2026-10-08T03:00:00Z', overall: 'critical', sources: [
        { key: 'market_news', label: 'Market news', description: 'Stored news',
          last_updated: null, fetched_at: '2026-10-08T03:00:00Z', age_days: null,
          status: 'unknown', timestamp_basis: 'published_date', scope: 'published_articles', next_sync: null },
        { key: 'foreign_trading', label: 'Foreign trading', description: 'Stored flow',
          last_updated: '2026-10-07T00:00:00Z', fetched_at: null, age_days: 1,
          status: 'fresh', timestamp_basis: 'trade_date', scope: 'raw_stored_rows', next_sync: null },
        { key: 'financial_ratios', label: 'Financial ratios', description: 'Stored ratios',
          last_updated: '2026-10-07T18:00:00Z', fetched_at: null, age_days: 1,
          status: 'fresh', timestamp_basis: 'updated_at', scope: 'sync_storage_timestamps', next_sync: null },
      ],
    }, isLoading: false, error: null, refetch: jest.fn(), isFetching: false,
  } as unknown as UseQueryResult<DataSourcesFreshnessResponse, Error>);

  render(<DataSourcesHealthPanel />);

  expect(screen.getByRole('columnheader', { name: 'As-of / basis' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Fetched / crawled' })).toBeInTheDocument();
  const news = screen.getByText('Market news').closest('tr')!;
  expect(within(news).getByText('Scope: published articles')).toBeInTheDocument();
  expect(within(news).getByText('published_date')).toBeInTheDocument();
  expect(within(news).getAllByText('Unknown')).toHaveLength(2);
  expect(within(news).queryByText('Fresh')).not.toBeInTheDocument();
  expect(screen.getByText('Scope: raw stored rows')).toBeInTheDocument();
  expect(screen.getByText('Storage fresh')).toBeInTheDocument();
  expect(screen.getByText('Scope: sync storage timestamps')).toBeInTheDocument();
});
