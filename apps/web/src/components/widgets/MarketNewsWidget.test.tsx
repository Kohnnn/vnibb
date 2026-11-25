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
  match_evidence: { matched_terms: [{ field: 'title', kind: 'sector_keyword', term: 'steel' }] },
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

test('rejects old market fallback under Related and offers All News separately', async () => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const isRelated = new URL(String(input)).searchParams.get('mode') === 'related';
    return {
      ok: true,
      json: async () => isRelated
        ? { mode: 'related', fallback_used: true, articles: [{ ...boilerplate, association_class: 'general_market' }] }
        : { mode: 'all', articles: [boilerplate] },
    } as Response;
  });
  render(<QueryClientProvider client={client}><MarketNewsWidget symbol="HPG" /></QueryClientProvider>);

  expect(await screen.findByText(/No related news found for HPG/)).toBeVisible();
  expect(screen.queryByText(boilerplate.title)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View All News' }));
  expect(await screen.findByRole('link', { name: /Cholesterol cao/ })).toBeVisible();
});

test('keeps direct and sector matches but rejects unverified cached health articles', async () => {
  const direct = {
    ...boilerplate, id: 'direct', title: 'HPG issuer update', published_date: null,
    association_class: 'direct_company', match_reason: 'exact_symbol_title', matched_symbols: ['HPG'],
    match_evidence: { matched_terms: [{ term: 'HPG', field: 'title', kind: 'symbol' }] },
  };
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ mode: 'related', articles: [direct, steel, { ...boilerplate, association_class: 'direct_company', match_evidence: { matched_terms: [{ field: 'related_symbols', kind: 'symbol' }] } }] }),
  });
  render(<QueryClientProvider client={client}><MarketNewsWidget symbol="HPG" /></QueryClientProvider>);

  const row = await screen.findByRole('link', { name: /HPG issuer update/ });
  expect(row).toHaveTextContent('Date unavailable');
  expect(screen.getByText('Steel production fixture')).toBeVisible();
  expect(screen.queryByText(boilerplate.title)).not.toBeInTheDocument();
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
