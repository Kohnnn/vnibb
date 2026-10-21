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
