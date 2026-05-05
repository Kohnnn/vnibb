'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { DEFAULT_TICKER, normalizeTickerSymbol, readStoredTicker, writeStoredTicker } from '@/lib/defaultTicker';

interface SymbolLinkContextType {
  globalSymbol: string;
  setGlobalSymbol: (symbol: string) => void;
  linkedWidgets: Set<string>;
  toggleWidgetLink: (widgetId: string) => void;
  isWidgetLinked: (widgetId: string) => boolean;
}

const SymbolLinkContext = createContext<SymbolLinkContextType | null>(null);

export function SymbolLinkProvider({ children }: { children: ReactNode }) {
  const [globalSymbol, setGlobalSymbolState] = useState<string>(DEFAULT_TICKER);
  const [linkedWidgets, setLinkedWidgets] = useState<Set<string>>(new Set());

  useEffect(() => {
    setGlobalSymbolState(readStoredTicker());
  }, []);

  useEffect(() => {
    writeStoredTicker(globalSymbol);
  }, [globalSymbol]);

  const setGlobalSymbol = useCallback((symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;
    setGlobalSymbolState(normalized);
  }, []);

  const toggleWidgetLink = useCallback((widgetId: string) => {
    setLinkedWidgets(prev => {
      const next = new Set(prev);
      if (next.has(widgetId)) {
        next.delete(widgetId);
      } else {
        next.add(widgetId);
      }
      return next;
    });
  }, []);

  const isWidgetLinked = useCallback((widgetId: string) => {
    return linkedWidgets.has(widgetId);
  }, [linkedWidgets]);

  return (
    <SymbolLinkContext.Provider value={{
      globalSymbol,
      setGlobalSymbol,
      linkedWidgets,
      toggleWidgetLink,
      isWidgetLinked,
    }}>
      {children}
    </SymbolLinkContext.Provider>
  );
}

export function useSymbolLink() {
  const context = useContext(SymbolLinkContext);
  if (!context) {
    throw new Error('useSymbolLink must be used within SymbolLinkProvider');
  }
  return context;
}
