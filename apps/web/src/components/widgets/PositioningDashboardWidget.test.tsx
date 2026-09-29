import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSymbolsByGroup } from '@/lib/queries';
import * as api from '@/lib/api';
import { widgetRegistry } from './WidgetRegistry';
import { widgetDefinitions } from '@/data/widgetDefinitions';

jest.mock('@/lib/queries', () => ({ useSymbolsByGroup: jest.fn() }));
jest.mock('@/lib/api', () => ({ getTransactionFlow: jest.fn() }));

const Positioning = widgetRegistry.get('positioning_dashboard')!.component;

function showPositioning(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <React.Suspense fallback={<span>Loading widget</span>}>
        <Positioning id="saved-positioning" symbol="FPT" />
      </React.Suspense>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.mocked(useSymbolsByGroup).mockReturnValue({
    data: { data: [{ symbol: 'FPT' }] }, isLoading: false, error: null, refetch: jest.fn(),
  } as never);
});

describe('positioning_dashboard admission gate', () => {
  it('stays out of the widget library while its bounded request audit is outstanding', () => {
    expect(widgetDefinitions.some((definition) => definition.type === 'positioning_dashboard')).toBe(false);
    expect(widgetRegistry.has('positioning_dashboard')).toBe(true);
  });

  it('declares the widget unavailable without issuing per-symbol flow requests', async () => {
    showPositioning();

    expect(await screen.findByText('Positioning Dashboard unavailable')).toBeInTheDocument();
    expect(screen.getByText(/deferred until request count and source coverage pass the admission gate/)).toBeInTheDocument();
    expect(useSymbolsByGroup).not.toHaveBeenCalled();
    expect(api.getTransactionFlow).not.toHaveBeenCalled();
    expect(screen.queryByText('No investor-bucket flow available')).not.toBeInTheDocument();
  });
});
