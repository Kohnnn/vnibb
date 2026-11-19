import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { NewsFeedWidget } from './NewsFeedWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
jest.mock('@/components/ui/WidgetContainer', () => ({
    WidgetContainer: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

test('preserves HTTP 429 as a rate limit and recovers the surviving feed through retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const originalFetch = globalThis.fetch;
    let feedRequests = 0;
    const article = {
        id: 'fpt-notice', title: 'FPT issuer notice', source: 'Issuer disclosure',
        url: 'https://fpt.com/en/ir', published_at: '2026-10-20T06:00:00Z',
        related_symbols: ['FPT'], sectors: [], sentiment: 'neutral', read_count: 0, bookmarked: false,
    };
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/news/sentiment')) {
            return { ok: false, status: 503, statusText: 'Service Unavailable' } as Response;
        }
        expect(url.pathname).toBe('/api/v1/news/feed');
        expect(url.searchParams.get('symbol')).toBe('FPT');
        feedRequests += 1;
        return feedRequests === 1
            ? { ok: false, status: 429, statusText: 'Too Many Requests' } as Response
            : { ok: true, status: 200, json: async () => ({ articles: [article], count: 1 }) } as Response;
    });
    globalThis.fetch = fetchMock;
    const view = render(
        <QueryClientProvider client={client}><NewsFeedWidget symbol="FPT" /></QueryClientProvider>,
    );
    try {
        expect(await screen.findByText('Too Many Requests')).toBeInTheDocument();
        expect(screen.getByText('Please wait a moment before retrying.')).toBeInTheDocument();
        expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
        expect(screen.queryByText(/No news available/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(await screen.findByText('FPT issuer notice')).toBeInTheDocument();
        expect(screen.getByText('Showing 1 of 1 articles')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Too Many Requests')).not.toBeInTheDocument());
        expect(feedRequests).toBe(2);
    } finally {
        view.unmount();
        client.clear();
        globalThis.fetch = originalFetch;
    }
});

test('distinguishes exact symbol evidence, uncertain sector scores, zero fallback and absent metadata', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const originalFetch = globalThis.fetch;
    const base = { source: 'Stored source', published_date: '2026-09-21T14:17:14', related_symbols: ['CEO'], sectors: [], read_count: 0, bookmarked: false };
    const articles = [
        { ...base, id: 130723, title: 'Giá thép xây dựng tăng trong quý này', relevance_score: null, matched_symbols: [], match_reason: 'sector_keyword', association_class: 'verified_sector' },
        { ...base, id: 'exact', title: 'MSR issuer notice', relevance_score: 1, matched_symbols: ['MSR'], match_reason: 'exact_symbol_title', association_class: 'direct_company' },
        { ...base, id: 'zero', title: 'General market fallback', relevance_score: 0, matched_symbols: [], match_reason: null, is_market_wide_fallback: true, association_class: 'general_market' },
        { ...base, id: 'missing', title: 'No association metadata' },
    ];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => ({
        ok: true, status: 200, json: async () => String(input).includes('/news/feed') ? { articles, total: articles.length } : {},
    } as Response));
    const view = render(<QueryClientProvider client={client}><NewsFeedWidget symbol="MSR" /></QueryClientProvider>);
    try {
        expect(await screen.findByText(articles[0].title)).toBeInTheDocument();
        expect(screen.getAllByText('Association unverified')).toHaveLength(1);
        expect(screen.getByText('Industry overlap · no company evidence')).toBeInTheDocument();
        expect(screen.getByText('Symbol mention: MSR')).toBeInTheDocument();
        expect(screen.getByText('Market-wide fallback')).toBeInTheDocument();
        expect(screen.getByTitle(/Reason: sector_keyword; matched symbols: none; score: unavailable/)).toHaveTextContent('Industry overlap · no company evidence');
        expect(screen.getByTitle(/Reason: unavailable; matched symbols: none; score: 0/)).toHaveTextContent('Market-wide fallback');
        expect(screen.queryByText(/54%|84%|rank [0-9]/)).not.toBeInTheDocument();
        expect(screen.getAllByText('Source tags:')).toHaveLength(4);
    } finally {
        view.unmount();
        client.clear();
        globalThis.fetch = originalFetch;
    }
});

describe('Company News association', () => {
    const base = { source: 'QA fixture only', published_date: '2026-11-16T04:15:00Z', related_symbols: [], sectors: [] };
    const direct = { ...base, id: 'direct', title: 'HPG publishes a fixture update', association_class: 'direct_company', match_reason: 'exact_symbol_title', matched_symbols: ['HPG'] };
    const peer = { ...base, id: 'peer', title: 'QAP publishes a fixture update', association_class: 'verified_peer', match_reason: 'peer_mentions', matched_symbols: ['QAP'], relevance_score: 0.68 };
    const sector = { ...base, id: 'sector', title: 'Steel production fixture', association_class: 'verified_sector', match_reason: 'sector_keyword', relevance_score: null };
    const market = { ...base, id: 'market', title: 'Russian tourist deportation', association_class: 'general_market', is_market_wide_fallback: true };
    const unverified = { ...base, id: 'unknown', title: 'Unverified fixture', association_class: 'none' };
    const originalFetch = globalThis.fetch;
    let client: QueryClient;

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-11-18T02:00:00Z') });
        client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    });

    afterEach(() => {
        client.clear();
        globalThis.fetch = originalFetch;
        jest.useRealTimers();
    });

    function show(articles: readonly object[], fallback_used = false) {
        globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => ({
            ok: true,
            json: async () => new URL(String(input)).pathname.endsWith('/news/feed') ? { articles, fallback_used } : {},
        } as Response));
        render(<QueryClientProvider client={client}><NewsFeedWidget symbol="HPG" /></QueryClientProvider>);
    }

    test('names the verified peer without calling it an HPG mention', async () => {
        show([peer]);
        expect(await screen.findByText('Verified peer: QAP')).toBeVisible();
        expect(screen.queryByText('Symbol mention: HPG')).not.toBeInTheDocument();
    });

    test('labels an all-market response as fallback and does not chart ticker momentum', async () => {
        show([{ ...direct, title: market.title, relevance_score: 1 }], true);
        expect(await screen.findByRole('heading', { name: market.title })).toBeVisible();
        expect(screen.queryByText('HPG related feed')).not.toBeInTheDocument();
        expect(screen.getAllByText('Market-wide fallback')).toHaveLength(2);
        expect(screen.getByTitle(/matched symbols: none; score: unavailable; class: general_market/)).toBeVisible();
        expect(screen.queryByText(/news momentum|articles in 7d/i)).not.toBeInTheDocument();
    });

    test('counts only admitted direct, peer, and sector articles in a mixed feed', async () => {
        show([direct, peer, sector, market, unverified]);
        expect(await screen.findByText('3/3 articles in 7d')).toBeVisible();
        expect(screen.getByText('HPG news momentum')).toBeVisible();
        expect(screen.getByText('Showing 5 of 5 articles')).toBeVisible();
    });
});
