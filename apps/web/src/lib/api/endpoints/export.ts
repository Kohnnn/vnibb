// Export API endpoints

import { fetchAPI } from '../client';
import { API_BASE_URL } from '../config';

export function getExportUrl(endpoint: string, params: Record<string, string | number>): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        searchParams.append(key, String(value));
    });
    return `${API_BASE_URL}${endpoint}?${searchParams.toString()}`;
}

export async function exportFinancials(
    symbol: string,
    options?: {
        statement_type?: string;
        period?: string;
        format?: 'csv' | 'xlsx';
    }
): Promise<Blob> {
    const response = await fetch(getExportUrl(`/export/financials/${symbol}`, {
        statement_type: options?.statement_type || 'all',
        period: options?.period || 'annual',
        format: options?.format || 'csv',
    } as Record<string, string>));

    if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
    }

    return response.blob();
}

export async function exportHistorical(
    symbol: string,
    options?: {
        start_date?: string;
        end_date?: string;
        interval?: string;
        format?: 'csv' | 'xlsx';
    }
): Promise<Blob> {
    const response = await fetch(getExportUrl(`/export/historical/${symbol}`, {
        start_date: options?.start_date || '',
        end_date: options?.end_date || '',
        interval: options?.interval || '1d',
        format: options?.format || 'csv',
    } as Record<string, string>));

    if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
    }

    return response.blob();
}

export async function exportPeers(
    symbols: string[],
    options?: {
        period?: string;
        format?: 'csv' | 'xlsx';
    }
): Promise<Blob> {
    const response = await fetch(getExportUrl('/export/peers', {
        symbols: symbols.join(','),
        period: options?.period || 'annual',
        format: options?.format || 'csv',
    } as Record<string, string>));

    if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
    }

    return response.blob();
}
