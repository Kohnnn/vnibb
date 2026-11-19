import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarketNewsWidget } from './MarketNewsWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const boilerplate = {
  id: 'cholesterol',
  title: 'Cholesterol cao: dấu hiệu cảnh báo bạn cần đi khám',
  summary: 'Synthetic QA label only. Related news: HPG / steel.',
  source: 'QA fixture only',
  url: 'https://fixture.invalid/news/cholesterol',
  published_date: '2026-11-16T04:15:00Z',
};

const originalFetch = globalThis.fetch;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const steel = {
  id: 'sector',
  title: 'Steel production fixture',
  source: 'QA fixture only',
  url: 'https://fixture.invalid/news/sector',
  published_date: '2026-11-16T04:15:00Z',
  association_class: 'verified_sector',
  match_reason: 'sector_keyword',
  relevance_score: null,
  matched_symbols: [],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  client.clear();
});

test('shows industry-only provenance without a company rank on an admitted sector article', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ mode: 'related', articles: [steel], fallback_used: false }),
  });
  render(<QueryClientProvider client={client}><MarketNewsWidget symbol="HPG" /></QueryClientProvider>);

  const row = await screen.findByRole('link', { name: /Steel production fixture/ });
  expect(row).toHaveTextContent('Industry overlap · no company evidence');
  expect(row).not.toHaveTextContent(/rank|\bHPG\b/i);
});

test('keeps market fallback boilerplate readable without ticker-match markup', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      mode: 'related', fallback_used: true,
      articles: [{ ...boilerplate, association_class: 'general_market', is_market_wide_fallback: true, relevance_score: 0 }],
    }),
  });
  render(<QueryClientProvider client={client}><MarketNewsWidget symbol="HPG" /></QueryClientProvider>);

  const row = await screen.findByRole('link', { name: /Cholesterol cao/ });
  expect(row).toHaveAttribute('href', boilerplate.url);
  expect(row).toHaveTextContent(boilerplate.summary);
  expect(row).toHaveTextContent(/market-wide/i);
  expect(row.querySelector('mark')).not.toBeInTheDocument();
  expect(row).not.toHaveTextContent(/rank/i);
});

test('shows both articles as plain text when switching from related to All News', async () => {
  const direct = {
    ...boilerplate,
    id: 'direct', title: 'HPG publishes a fixture update', url: 'https://fixture.invalid/news/direct',
  };
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const { searchParams } = new URL(String(input));
    const generic = searchParams.get('mode') === 'all' && !searchParams.has('symbol');
    return {
      ok: true,
      json: async () => generic
        ? { mode: 'all', articles: [boilerplate, direct] }
        : { mode: 'related', articles: [{
          ...direct, association_class: 'direct_company', match_reason: 'exact_symbol_title',
          relevance_score: 1, matched_symbols: ['HPG'],
          match_evidence: { matched_terms: [{ term: 'HPG', field: 'title', kind: 'symbol' }] },
        }] },
    } as Response;
  });
  render(<QueryClientProvider client={client}><MarketNewsWidget symbol="HPG" /></QueryClientProvider>);

  const directRow = await screen.findByRole('link', { name: /HPG publishes a fixture update/ });
  expect(directRow.querySelector('mark')).toHaveTextContent('HPG');
  fireEvent.click(screen.getByRole('button', { name: 'All News' }));

  const marketRow = await screen.findByRole('link', { name: /Cholesterol cao/ });
  expect(screen.getByText('Global feed')).toBeVisible();
  expect(marketRow).toHaveTextContent(boilerplate.summary);
  expect(marketRow.querySelector('mark')).not.toBeInTheDocument();
  const genericDirectRow = screen.getByRole('link', { name: /HPG publishes a fixture update/ });
  expect(genericDirectRow.querySelector('mark')).not.toBeInTheDocument();
  expect(genericDirectRow).not.toHaveTextContent(/rank|association|market-wide/i);
});
