// News API endpoints

import { fetchAPI } from '../client';

export type WorldNewsRegion = 'vietnam' | 'asia' | 'us' | 'europe' | 'middleeast' | 'africa' | 'latam' | 'oceania' | 'global';
export type WorldNewsCategory = 'markets' | 'economy' | 'business' | 'geopolitics' | 'technology';
export type WorldNewsLanguage = 'vi' | 'en';

export interface WorldNewsArticle {
    id: string;
    title: string;
    summary: string | null;
    source_id: string;
    source: string;
    source_domain: string;
    source_url: string;
    feed_url: string;
    url: string;
    published_at: string | null;
    region: WorldNewsRegion;
    category: WorldNewsCategory;
    language: WorldNewsLanguage;
    tags: string[];
    relevance_score: number;
    live: boolean;
}

export interface WorldNewsFeedResponse {
    articles: WorldNewsArticle[];
    total: number;
    fetched_at: string;
    source_count: number;
    feed_count: number;
    failed_feed_count: number;
    freshness_hours: number;
}

export interface WorldNewsSourceInfo {
    id: string;
    name: string;
    domain: string;
    region: WorldNewsRegion;
    category: WorldNewsCategory;
    language: WorldNewsLanguage;
    tier: number;
    homepage_url: string;
    feed_urls: string[];
    country_code: string;
    country_name: string;
    latitude: number;
    longitude: number;
    map_region: string;
}

export interface WorldNewsSourcesResponse {
    sources: WorldNewsSourceInfo[];
    total: number;
}

export interface WorldNewsMapBucket {
    id: string;
    label: string;
    region: string;
    country_code: string;
    country_name: string;
    latitude: number;
    longitude: number;
    article_count: number;
    source_count: number;
    failed_feed_count: number;
}

export async function getWorldNews(options?: {
    region?: WorldNewsRegion;
    category?: WorldNewsCategory;
    language?: WorldNewsLanguage;
    limit?: number;
    freshnessHours?: number;
    signal?: AbortSignal;
}): Promise<WorldNewsFeedResponse> {
    return fetchAPI<WorldNewsFeedResponse>('/news/world', {
        params: {
            region: options?.region,
            category: options?.category,
            language: options?.language,
            limit: options?.limit,
            freshness_hours: options?.freshnessHours,
        },
        signal: options?.signal,
    });
}

export async function getWorldNewsSources(options?: {
    region?: WorldNewsRegion;
    category?: WorldNewsCategory;
    language?: WorldNewsLanguage;
    signal?: AbortSignal;
}): Promise<WorldNewsSourcesResponse> {
    return fetchAPI<WorldNewsSourcesResponse>('/news/world-sources', {
        params: {
            region: options?.region,
            category: options?.category,
            language: options?.language,
        },
        signal: options?.signal,
    });
}

export async function getWorldNewsMap(options?: {
    region?: WorldNewsRegion;
    category?: WorldNewsCategory;
    limit?: number;
    freshnessHours?: number;
    signal?: AbortSignal;
}): Promise<{ buckets: WorldNewsMapBucket[]; total: number }> {
    return fetchAPI<{ buckets: WorldNewsMapBucket[]; total: number }>('/news/world-map', {
        params: {
            region: options?.region,
            category: options?.category,
            limit: options?.limit,
            freshness_hours: options?.freshnessHours,
        },
        signal: options?.signal,
    });
}
