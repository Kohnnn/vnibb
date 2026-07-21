// TanStack Query provider wrapper

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { queryRetryDelay, shouldRetryQuery } from './queryRetry';

const ReactQueryDevtools = process.env.NODE_ENV === 'development'
    ? dynamic(() => import('@tanstack/react-query-devtools').then((module) => module.ReactQueryDevtools), { ssr: false })
    : null;

export function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000, // 1 minute
                refetchOnWindowFocus: false,
                retry: shouldRetryQuery,
                retryDelay: queryRetryDelay,
                networkMode: 'online', // Only run queries when online
            },
            mutations: {
                retry: false,
                networkMode: 'online',
            },
        },
    });
}

export function QueryProvider({ children }: { children: any }) {
    const [queryClient] = useState(createQueryClient);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            {ReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
        </QueryClientProvider>
    );
}
