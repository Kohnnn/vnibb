import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

test('reports market-wide provenance when every loaded row is fallback', async () => {
  const changes = show(() => ({ mode: 'related', items: [market], fallback_used: true }));
  const row = await screen.findByRole('link', { name: /Cholesterol cao/ });
  expect(row).toHaveAttribute('href', market.url);
  expect(row).toHaveTextContent(market.summary);
  expect(row.querySelector('mark')).not.toBeInTheDocument();
  expect(row).toHaveTextContent('Market-wide fallback');
  expect(row).not.toHaveTextContent(/rank/i);
  expect(within(screen.getByLabelText('News flow stream')).queryByText(/^Ticker feed$/i)).not.toBeInTheDocument();
  expect(changes.mock.lastCall?.[0].__widgetRuntime?.provenance?.sourceLabel).toMatch(/market-wide/i);
});

test('keeps a paginated stream with admitted rows a ticker feed', async () => {
  const changes = show(offset => offset === '0'
    ? { mode: 'related', items: [market], fallback_used: true, has_more: true }
    : { mode: 'related', items: [direct], fallback_used: false, has_more: false });
  await screen.findByRole('link', { name: /Cholesterol cao/ });
  fireEvent.click(screen.getByRole('button', { name: /load more articles/i }));

  const directRow = await screen.findByRole('link', { name: /HPG publishes a fixture update/ });
  expect(directRow).toHaveTextContent(/rank 100\/100/i);
  expect(screen.getByRole('link', { name: /Cholesterol cao/ })).toHaveTextContent(/market-wide/i);
  expect(within(screen.getByLabelText('News flow stream')).getByText(/^Ticker feed$/i)).toBeVisible();
  expect(changes.mock.lastCall?.[0].__widgetRuntime?.provenance?.sourceLabel).toMatch(/ticker feed/i);
});


test('applies a fallback envelope only to its own page, even with stale rank metadata', async () => {
  const fallback = { ...direct, id: market.id, title: market.title, url: market.url };
  show(offset => offset === '0'
    ? { mode: 'related', items: [direct], has_more: true }
    : { mode: 'related', items: [fallback], fallback_used: true });
  await screen.findByRole('link', { name: /HPG publishes a fixture update/ });
  fireEvent.click(screen.getByRole('button', { name: /load more articles/i }));

  const fallbackRow = await screen.findByRole('link', { name: /Cholesterol cao/ });
  expect(fallbackRow).toHaveTextContent('Market-wide fallback');
  expect(fallbackRow).not.toHaveTextContent(/rank|\bHPG\b/i);
  expect(screen.getByRole('link', { name: /HPG publishes a fixture update/ })).toHaveTextContent(/rank 100\/100/i);
  expect(within(screen.getByLabelText('News flow stream')).getByText(/^Ticker feed$/i)).toBeVisible();
});
