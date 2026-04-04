'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  DEFAULT_GLOBAL_MARKETS_SYMBOL,
  normalizeGlobalMarketsSymbol,
  readStoredGlobalMarketsSymbol,
  writeStoredGlobalMarketsSymbol,
} from '@/lib/globalMarketsSymbol';

interface GlobalMarketsSymbolContextType {
  globalMarketsSymbol: string;
  setGlobalMarketsSymbol: (symbol: string) => void;
}

const GlobalMarketsSymbolContext = createContext<GlobalMarketsSymbolContextType | null>(null);

export function GlobalMarketsSymbolProvider({ children }: { children: ReactNode }) {
  const [globalMarketsSymbol, setGlobalMarketsSymbolState] = useState<string>(DEFAULT_GLOBAL_MARKETS_SYMBOL);

  useEffect(() => {
    setGlobalMarketsSymbolState(readStoredGlobalMarketsSymbol());
  }, []);

  useEffect(() => {
    writeStoredGlobalMarketsSymbol(globalMarketsSymbol);
  }, [globalMarketsSymbol]);

  const setGlobalMarketsSymbol = useCallback((symbol: string) => {
    const normalized = normalizeGlobalMarketsSymbol(symbol);
    if (!normalized) return;

    setGlobalMarketsSymbolState(normalized);
  }, []);

  return (
    <GlobalMarketsSymbolContext.Provider
      value={{
        globalMarketsSymbol,
        setGlobalMarketsSymbol,
      }}
    >
      {children}
    </GlobalMarketsSymbolContext.Provider>
  );
}

export function useGlobalMarketsSymbol() {
  const context = useContext(GlobalMarketsSymbolContext);
  if (!context) {
    throw new Error('useGlobalMarketsSymbol must be used within GlobalMarketsSymbolProvider');
  }

  return context;
}
