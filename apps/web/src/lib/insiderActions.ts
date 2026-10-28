/**
 * Normalized insider deal direction for Vietnamese and English provider text.
 *
 * Providers state direction as "Mua"/"Bán" or "Buy"/"Sell". Every consumer must
 * share this mapping so a SELL is never counted as a BUY and an unstated or
 * unmapped direction stays neutral (UNKNOWN) instead of defaulting to a sale.
 */

export type InsiderActionToken = 'BUY' | 'SELL' | 'UNKNOWN';

export function normalizeInsiderAction(value: string | null | undefined): InsiderActionToken | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toLowerCase();
    if (!text) return null;
    const isBuy = text.includes('mua') || text.includes('buy');
    const isSell = text.includes('bán') || text.includes('ban') || text.includes('sell');
    if (isBuy === isSell) return 'UNKNOWN';
    return isBuy ? 'BUY' : 'SELL';
}
