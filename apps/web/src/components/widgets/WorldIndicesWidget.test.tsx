import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { useWorldIndices } from '@/lib/queries';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({ useWorldIndices: jest.fn() }));
const worldQuery = jest.mocked(useWorldIndices);
const WorldIndices = widgetRegistry.get('world_indices')!.component;

function showIndices(data: object | undefined, error: Error | null) {
  worldQuery.mockReturnValue({
    data, error, isLoading: false, isFetching: false, refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  render(<React.Suspense fallback={<span>Loading widget</span>}><WorldIndices id="saved-indices" symbol="FPT" /></React.Suspense>);
}

describe('world_indices saved dashboard widget', () => {
  it('shows missing changes as unavailable without an up arrow while preserving reported changes', async () => {
    showIndices({ data: [
      { symbol: 'SPX', name: 'S&P 500', value: 5200, change_pct: null },
      { symbol: 'DJI', name: 'Dow Jones', value: 41000, change_pct: 0 },
      { symbol: 'N225', name: 'Nikkei', value: 38000, change_pct: 1.25 },
      { symbol: 'FTSE', name: 'FTSE 100', value: 8200, change_pct: -0.75 },
    ] }, null);
    await screen.findByText('S&P 500');

    const changeFor = (name: string) => screen.getByText(name).parentElement!.parentElement!.lastElementChild!.lastElementChild!;
    expect(changeFor('S&P 500')).toHaveTextContent('--');
    expect(changeFor('S&P 500')).toHaveClass('text-[var(--text-muted)]');
    expect(changeFor('S&P 500').querySelector('svg')).toBeNull();
    expect(changeFor('Dow Jones')).toHaveTextContent('0.00%');
    expect(changeFor('Dow Jones')).toHaveClass('text-[var(--text-muted)]');
    expect(changeFor('Dow Jones').querySelector('svg')).toBeNull();
    expect(changeFor('Nikkei')).toHaveTextContent('+1.25%');
    expect(changeFor('Nikkei').querySelector('svg')).toHaveClass('lucide-trending-up');
    expect(changeFor('FTSE 100')).toHaveTextContent('-0.75%');
    expect(changeFor('FTSE 100').querySelector('svg')).toHaveClass('lucide-trending-down');
  });

  it('keeps available rows and marks a failed refresh as cached', async () => {
    showIndices({ data: [{ symbol: 'SPX', name: 'S&P 500', value: 5200, change_pct: -1.25 }] }, new Error('Offline'));
    expect(await screen.findByText('S&P 500')).toBeInTheDocument();
    expect(screen.getByText('-1.25%')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
  });

  it('labels partially available rows when the source reports an error alongside data', async () => {
    showIndices({ data: [{ symbol: 'SPX', name: 'S&P 500', value: 5200, change_pct: -1.25 }], error: 'Source stale' }, null);
    expect(await screen.findByText('S&P 500')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
  });

  it('distinguishes an empty response from unavailable data', async () => {
    showIndices({ data: [] }, null);
    expect(await screen.findByText('No world index data available')).toBeInTheDocument();
    expect(screen.queryByText('Something Went Wrong')).not.toBeInTheDocument();
  });

  it('offers retry when no indices were returned after a failed request', async () => {
    showIndices(undefined, new Error('Indices unavailable'));
    expect(await screen.findByText('Indices unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('No world index data available')).not.toBeInTheDocument();
  });

  it('does not label an unsuccessful source response as an empty market', async () => {
    showIndices({ data: [], error: 'Global indices feed unavailable' }, null);
    expect(await screen.findByText('Global indices feed unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No world index data available')).not.toBeInTheDocument();
  });
});
