// News queries: world news and company news

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

// ============ Query Keys ============

export const newsQueryKeys = {
    worldNews: (params?: { limit?: number; category?: string }) => ['worldNews', params] as const,
    companyNews: (symbol: string, limit?: number) => ['companyNews', symbol, limit] as const,
};

// Re-export company news from equity for convenience
export { useCompanyNews } from './equity';
