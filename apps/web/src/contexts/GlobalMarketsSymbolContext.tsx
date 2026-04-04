'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useDashboard } from '@/contexts/DashboardContext';

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
const GLOBAL_MARKETS_DASHBOARD_ID = 'default-global-markets';

export function GlobalMarketsSymbolProvider({ children }: { children: ReactNode }) {
  const { state, updateDashboardRuntime } = useDashboard();
  const [globalMarketsSymbol, setGlobalMarketsSymbolState] = useState<string>(DEFAULT_GLOBAL_MARKETS_SYMBOL);

  const globalMarketsDashboard = useMemo(
    () => state.dashboards.find((dashboard) => dashboard.id === GLOBAL_MARKETS_DASHBOARD_ID) || null,
    [state.dashboards],
  );

  useEffect(() => {
    setGlobalMarketsSymbolState(readStoredGlobalMarketsSymbol());
  }, []);

  useEffect(() => {
    const dashboardSymbol = normalizeGlobalMarketsSymbol(globalMarketsDashboard?.globalMarketsSymbol);
    if (dashboardSymbol && dashboardSymbol !== globalMarketsSymbol) {
      setGlobalMarketsSymbolState(dashboardSymbol);
    }
  }, [globalMarketsDashboard?.globalMarketsSymbol, globalMarketsSymbol]);

  useEffect(() => {
    writeStoredGlobalMarketsSymbol(globalMarketsSymbol);
  }, [globalMarketsSymbol]);

  const setGlobalMarketsSymbol = useCallback((symbol: string) => {
    const normalized = normalizeGlobalMarketsSymbol(symbol);
    if (!normalized) return;

    setGlobalMarketsSymbolState(normalized);

    if (globalMarketsDashboard?.id && globalMarketsDashboard.globalMarketsSymbol !== normalized) {
      updateDashboardRuntime(globalMarketsDashboard.id, { globalMarketsSymbol: normalized });
    }
  }, [globalMarketsDashboard, updateDashboardRuntime]);

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
