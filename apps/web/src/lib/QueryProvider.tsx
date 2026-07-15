// TanStack Query provider wrapper

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const ReactQueryDevtools = process.env.NODE_ENV === 'development'
    ? dynamic(() => import('@tanstack/react-query-devtools').then((module) => module.ReactQueryDevtools), { ssr: false })
    : null;

export function QueryProvider({ children }: { children: any }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000, // 1 minute
                        refetchOnWindowFocus: false,
                        retry: 3, // Retry failed requests 3 times
                        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff: 1s, 2s, 4s, capped at 30s
                        networkMode: 'online', // Only run queries when online
                    },
                    mutations: {
                        retry: 1, // Mutations retry once
                        networkMode: 'online',
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            {ReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
        </QueryClientProvider>
    );
}
