// usePortfolio hook - Portfolio management with localStorage persistence
'use client';

import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';

// ============================================================================
// Types
// ============================================================================

export interface Position {
    id: string;
    symbol: string;
    quantity: number;
    avgCost: number;
    purchaseDate: string;  // ISO date
    notes?: string;
}

export interface PortfolioValueSnapshot {
    date: string;  // ISO date
    totalValue: number;
    totalCost: number;
}

export interface Portfolio {
    positions: Position[];
    cashBalance: number;
    valueHistory: PortfolioValueSnapshot[];
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const PORTFOLIO_STORAGE_KEY = 'vnibb_portfolio_v2';

const DEFAULT_PORTFOLIO: Portfolio = {
    positions: [],
    cashBalance: 0,
    valueHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

// ============================================================================
// Hook
// ============================================================================

export function usePortfolio() {
    const [portfolio, setPortfolio, clearPortfolio] = useLocalStorage<Portfolio>(
        PORTFOLIO_STORAGE_KEY,
        DEFAULT_PORTFOLIO
    );

    // Add a new position
    const addPosition = useCallback((
        position: Omit<Position, 'id'>
    ): Position => {
        const newPosition: Position = {
            ...position,
            id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            symbol: position.symbol.toUpperCase().trim(),
        };

        setPortfolio(prev => ({
            ...prev,
            positions: [...prev.positions, newPosition],
            updatedAt: new Date().toISOString(),
        }));

        return newPosition;
    }, [setPortfolio]);

    // Update an existing position
    const updatePosition = useCallback((
        id: string,
        updates: Partial<Omit<Position, 'id'>>
    ): boolean => {
        let found = false;

        setPortfolio(prev => {
            const idx = prev.positions.findIndex(p => p.id === id);
            if (idx === -1) return prev;

            found = true;
            const updatedPositions = [...prev.positions];
            updatedPositions[idx] = {
                ...updatedPositions[idx],
                ...updates,
                symbol: updates.symbol 
                    ? updates.symbol.toUpperCase().trim() 
                    : updatedPositions[idx].symbol,
            };

            return {
                ...prev,
                positions: updatedPositions,
                updatedAt: new Date().toISOString(),
            };
        });

        return found;
    }, [setPortfolio]);

    // Remove a position
    const removePosition = useCallback((id: string): boolean => {
        let found = false;

        setPortfolio(prev => {
            const idx = prev.positions.findIndex(p => p.id === id);
            if (idx === -1) return prev;

            found = true;
            return {
                ...prev,
                positions: prev.positions.filter(p => p.id !== id),
                updatedAt: new Date().toISOString(),
            };
        });

        return found;
    }, [setPortfolio]);

    // Update cash balance
    const setCashBalance = useCallback((amount: number) => {
        setPortfolio(prev => ({
            ...prev,
            cashBalance: Math.max(0, amount),
            updatedAt: new Date().toISOString(),
        }));
    }, [setPortfolio]);

    // Record portfolio value snapshot (for history chart)
    const recordValueSnapshot = useCallback((totalValue: number, totalCost: number) => {
        const today = new Date().toISOString().split('T')[0];

        setPortfolio(prev => {
            // Check if we already have a snapshot for today
            const existingIdx = prev.valueHistory.findIndex(s => s.date === today);
            
            let newHistory: PortfolioValueSnapshot[];
            if (existingIdx >= 0) {
                // Update today's snapshot
                newHistory = [...prev.valueHistory];
                newHistory[existingIdx] = { date: today, totalValue, totalCost };
            } else {
                // Add new snapshot, keep last 90 days
                newHistory = [
                    ...prev.valueHistory.slice(-89),
                    { date: today, totalValue, totalCost }
                ];
            }

            return {
                ...prev,
                valueHistory: newHistory,
                updatedAt: new Date().toISOString(),
            };
        });
    }, [setPortfolio]);

    // Get unique symbols for price fetching
    const symbols = useMemo(() => 
        [...new Set(portfolio.positions.map(p => p.symbol))],
        [portfolio.positions]
    );

    // Calculate total cost basis
    const totalCost = useMemo(() => 
        portfolio.positions.reduce((sum, p) => sum + p.quantity * p.avgCost, 0),
        [portfolio.positions]
    );

    return {
        portfolio,
        positions: portfolio.positions,
        cashBalance: portfolio.cashBalance,
        valueHistory: portfolio.valueHistory,
        symbols,
        totalCost,
        addPosition,
        updatePosition,
        removePosition,
        setCashBalance,
        recordValueSnapshot,
        clearPortfolio,
    };
}
