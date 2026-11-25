import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewsFlowWidget } from './NewsFlowWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const originalFetch = globalThis.fetch;
const base = { source: 'QA fixture only', sentiment: null, published_at: '2026-11-16T04:15:00Z' };
const market = {
  ...base,
  id: 'market',
  title: 'Cholesterol cao: dấu hiệu cảnh báo bạn cần đi khám',
  summary: 'Synthetic QA label only. Related news: HPG / steel.',
  url: 'https://fixture.invalid/news/market',
  symbols: [],
  association_class: 'general_market',
  is_market_wide_fallback: true,
  relevance_score: 0,
};
const direct = {
  ...base,
  id: 'direct',
  title: 'HPG publishes a fixture update',
  url: 'https://fixture.invalid/news/direct',
  symbols: [],
  matched_symbols: ['HPG'],
  association_class: 'direct_company',
  match_reason: 'exact_symbol_title',
  match_evidence: { matched_terms: [{ field: 'title', kind: 'symbol' }] },
  relevance_score: 1,
};

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
  globalThis.fetch = originalFetch;
});

function show(readPage: (offset: string | null) => object) {
  const onDataChange = jest.fn<void, [WidgetDataPayload]>();
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const { pathname, searchParams } = new URL(String(input));
    expect(pathname).toBe('/api/v1/news/flow');
    expect(searchParams.get('symbols')).toBe('HPG');
    return { ok: true, json: async () => readPage(searchParams.get('offset')) } as Response;
  });
  render(<QueryClientProvider client={client}>
    <NewsFlowWidget id="qa-flow" symbol="HPG" onDataChange={onDataChange} />
  </QueryClientProvider>);
  return onDataChange;
}

test('rejects an old market-wide fallback from a ticker flow', async () => {
  const changes = show(() => ({ mode: 'related', items: [market], fallback_used: true }));
  expect(await screen.findByText(/No related news found/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /Cholesterol cao/ })).not.toBeInTheDocument();
  expect(changes.mock.lastCall?.[0].__widgetRuntime?.provenance?.sourceLabel).toMatch(/ticker feed/i);
});

test('shows supported ticker stories and hides unverified rows', async () => {
  show(() => ({ mode: 'related', items: [direct, market, { ...market, id: 'none', association_class: 'none', is_market_wide_fallback: false }] }));
  const directRow = await screen.findByRole('link', { name: /HPG publishes a fixture update/ });
  expect(directRow).toHaveTextContent(/rank 100\/100/i);
  expect(screen.queryByRole('link', { name: /Cholesterol cao/ })).not.toBeInTheDocument();
});

test('keeps later pages reachable when every first-page item is rejected', async () => {
  show(offset => offset === '0'
    ? { mode: 'related', items: [market], fallback_used: true, has_more: true }
    : { mode: 'related', items: [direct], has_more: false });
  expect(await screen.findByText(/No related news found/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /load more articles/i }));
  expect(await screen.findByRole('link', { name: /HPG publishes a fixture update/ })).toBeVisible();
  expect(screen.queryByText(market.title)).not.toBeInTheDocument();
});
