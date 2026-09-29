import { act, renderHook } from '@testing-library/react';
import { usePortfolio } from './usePortfolio';

const KEY = 'vnibb_portfolio_v2';
const position = (symbol: string, quantity = 10) => ({
    symbol, quantity, avgCost: 1000, purchaseDate: '2026-09-29',
});

describe('usePortfolio committed holdings', () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it('persists both rapid additions against the latest committed state', () => {
        const { result } = renderHook(() => usePortfolio());
        act(() => {
            expect(result.current.addPosition(position('FPT'))).not.toBeNull();
            expect(result.current.addPosition(position('VNM'))).not.toBeNull();
        });
        expect(result.current.positions.map(p => p.symbol)).toEqual(['FPT', 'VNM']);
        expect(JSON.parse(window.localStorage.getItem(KEY)!).positions.map((p: { symbol: string }) => p.symbol)).toEqual(['FPT', 'VNM']);
    });

    it('keeps committed state on failed add, edit, removal and cash writes, then accepts retry', () => {
        const { result } = renderHook(() => usePortfolio());
        let id = '';
        act(() => { id = result.current.addPosition(position('FPT'))!.id; });
        const saved = window.localStorage.getItem(KEY);
        const realSetItem = Storage.prototype.setItem;
        const failure = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
        act(() => {
            expect(result.current.addPosition(position('VNM'))).toBeNull();
            expect(result.current.updatePosition(id, { quantity: 20 })).toBe(false);
            expect(result.current.removePosition(id)).toBe(false);
            result.current.setCashBalance(500);
        });
        expect(result.current.positions).toHaveLength(1);
        expect(result.current.positions[0].quantity).toBe(10);
        expect(result.current.cashBalance).toBe(0);
        expect(result.current.storageError).toMatch(/Could not save holdings/);
        expect(window.localStorage.getItem(KEY)).toBe(saved);
        failure.mockImplementation(realSetItem);
        act(() => { expect(result.current.updatePosition(id, { quantity: 20 })).toBe(true); });
        expect(result.current.positions[0].quantity).toBe(20);
        const { result: reloaded } = renderHook(() => usePortfolio());
        expect(reloaded.current.positions.map(p => p.symbol)).toEqual(['FPT']);
        expect(result.current.storageError).toBeNull();
    });

    it('rejects fractional, zero, negative, NaN and unsafe share quantities at the hook boundary', () => {
        const { result } = renderHook(() => usePortfolio());
        let id = '';
        act(() => { id = result.current.addPosition(position('FPT'))!.id; });
        const saved = window.localStorage.getItem(KEY);
        for (const quantity of [1.5, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            act(() => {
                expect(result.current.addPosition(position('VNM', quantity))).toBeNull();
                expect(result.current.updatePosition(id, { quantity })).toBe(false);
            });
        }
        expect(window.localStorage.getItem(KEY)).toBe(saved);
        expect(result.current.positions).toHaveLength(1);
    });
});
