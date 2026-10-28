import { normalizeInsiderAction } from './insiderActions';

// Real consumer contract: Vietnamese and English aliases, neutral UNKNOWN.
describe('normalizeInsiderAction', () => {
    it('maps Vietnamese and English aliases', () => {
        expect(normalizeInsiderAction('Mua')).toBe('BUY');
        expect(normalizeInsiderAction('Đăng ký mua')).toBe('BUY');
        expect(normalizeInsiderAction('Buy')).toBe('BUY');
        expect(normalizeInsiderAction('Bán')).toBe('SELL');
        expect(normalizeInsiderAction('Đăng ký bán')).toBe('SELL');
        expect(normalizeInsiderAction('Sell')).toBe('SELL');
    });

    it('treats missing and unmapped direction as neutral', () => {
        expect(normalizeInsiderAction(null)).toBeNull();
        expect(normalizeInsiderAction(undefined)).toBeNull();
        expect(normalizeInsiderAction('')).toBeNull();
        expect(normalizeInsiderAction('chuyển nhượng')).toBe('UNKNOWN');
    });
});
