import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const setGlobalSymbol = jest.fn();
const setGroupSymbol = jest.fn();
let detached = false;
let persistedOverride = false;
jest.mock('@/contexts/SymbolLinkContext', () => ({ useSymbolLink: () => ({ setGlobalSymbol }) }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ setGroupSymbol, tickerOverrideFor: () => detached ? 'FPT' : null }) }));
jest.mock('@/hooks/useDashboardWidget', () => ({ useDashboardWidget: () => ({ widget: { config: persistedOverride ? { tickerScope: 'override', symbol: 'FPT' } : {} } }) }));

const originalFetch = globalThis.fetch;
const listings = [
  { symbol: 'FPT', organName: 'FPT Corporation', exchange: 'HOSE', industry: 'Technology' },
  { symbol: 'VNM', organName: 'Vietnam Dairy Products', exchange: 'HOSE', industry: 'Consumer Staples' },
  { symbol: 'ABC', organName: null, exchange: 'UPCOM', industry: null },
  { symbol: 'VCB', organ_name: 'Vietcombank', exchange: 'HOSE', industry: 'Banking' },
];

beforeEach(() => {
  localStorage.clear();
  setGlobalSymbol.mockClear();
  setGroupSymbol.mockClear();
  detached = false;
  persistedOverride = false;
  globalThis.fetch = jest.fn(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v1/listing/symbols') return { ok: true, json: async () => ({ count: listings.length, data: listings }) } as Response;
    if (path === '/api/v1/listing/groups/VN30') return { ok: true, json: async () => ({ group: 'VN30', count: 2, data: listings.slice(0, 2) }) } as Response;
    throw new Error(`Unexpected request ${path}`);
  });
});

afterEach(() => { globalThis.fetch = originalFetch; });

function showListing(group: 'global' | 'A' = 'A', onSymbolClick?: (symbol: string) => void) {
  const Widget = widgetRegistry.get('listing_browser')!.component;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}><React.Suspense fallback={<span>Loading</span>}><Widget id="listing" symbol="FPT" widgetGroup={group} onSymbolClick={onSymbolClick} /></React.Suspense></QueryClientProvider>);
  return () => { view.unmount(); client.clear(); };
}

test('displays and searches wire company names while preserving group and missing-industry filters', async () => {
  const user = userEvent.setup();
  const cleanup = showListing();
  try {
    expect(await screen.findByText('Vietnam Dairy Products')).toBeInTheDocument();
    expect(screen.getByText('Vietcombank')).toBeInTheDocument();
    expect(screen.getByText('Industry unavailable')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search symbol, company, or industry...'), 'dairy');
    expect(screen.getByText('VNM')).toBeInTheDocument();
    expect(screen.queryByText('FPT')).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Search symbol, company, or industry...'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Group filter' }), 'VN30');
    await waitFor(() => {
      expect(screen.queryByText('ABC')).not.toBeInTheDocument();
      expect(screen.getByText('VNM')).toBeInTheDocument();
      expect(screen.getByText('FPT')).toBeInTheDocument();
    });
  } finally { cleanup(); }
});

test.each(['A', 'global'] as const)('row mouse and keyboard activation follow the %s ticker group', async (group) => {
  const user = userEvent.setup();
  const cleanup = showListing(group);
  try {
    const row = await screen.findByRole('button', { name: /VNM.*Vietnam Dairy Products/ });
    await user.click(row);
    row.focus();
    await user.keyboard('{Enter}');
    expect(setGroupSymbol).toHaveBeenCalledTimes(2);
    expect(setGroupSymbol).toHaveBeenCalledWith(group, 'VNM');
    if (group === 'global') expect(setGlobalSymbol).toHaveBeenCalledTimes(2);
    else expect(setGlobalSymbol).not.toHaveBeenCalled();
  } finally { cleanup(); }
});

test.each(['memory', 'persisted'] as const)('a %s detached listing does not change its group', async (mode) => {
  if (mode === 'memory') detached = true;
  else persistedOverride = true;
  const cleanup = showListing();
  try {
    expect(await screen.findByText('Vietnam Dairy Products')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /VNM.*Vietnam Dairy Products/ })).not.toBeInTheDocument();
    expect(setGroupSymbol).not.toHaveBeenCalled();
    expect(setGlobalSymbol).not.toHaveBeenCalled();
  } finally { cleanup(); }
});

test('a supplied callback selects a row without broadcasting for a detached listing', async () => {
  detached = true;
  const callback = jest.fn();
  const user = userEvent.setup();
  const cleanup = showListing('A', callback);
  try {
    await user.click(await screen.findByRole('button', { name: /VNM.*Vietnam Dairy Products/ }));
    expect(callback).toHaveBeenCalledWith('VNM');
    expect(setGroupSymbol).not.toHaveBeenCalled();
    expect(setGlobalSymbol).not.toHaveBeenCalled();
  } finally { cleanup(); }
});
