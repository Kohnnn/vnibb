'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useDashboard } from '@/contexts/DashboardContext';
import { GLOBAL_MARKETS_DASHBOARD_ID, GLOBAL_SYSTEM_TEMPLATE_IDS } from '@/contexts/DashboardContext/constants';
import type { Dashboard } from '@/types/dashboard';

import {
  DEFAULT_GLOBAL_MARKETS_SYMBOL,
  normalizeGlobalMarketsSymbol,
  readStoredGlobalMarketsSymbol,
  writeStoredGlobalMarketsSymbol,
} from '@/lib/globalMarketsSymbol';

interface GlobalMarketsSymbolContextType {
  globalMarketsSymbol: string;
  appGlobalMarketsSymbol: string;
  setGlobalMarketsSymbol: (symbol: string) => void;
  setGlobalMarketsSymbolForDashboard: (symbol: string, dashboard: Dashboard) => void;
}

const GlobalMarketsSymbolContext = createContext<GlobalMarketsSymbolContextType | null>(null);

export function GlobalMarketsSymbolProvider({ children }: { children: ReactNode }) {
  const { state, activeDashboard, updateDashboardRuntime } = useDashboard();
  const [appGlobalMarketsSymbol, setAppGlobalMarketsSymbol] = useState<string>(DEFAULT_GLOBAL_MARKETS_SYMBOL);

  const globalMarketsDashboard = useMemo(
    () => state.dashboards.find((dashboard) => dashboard.id === GLOBAL_MARKETS_DASHBOARD_ID) || null,
    [state.dashboards],
  );

  useEffect(() => {
    setAppGlobalMarketsSymbol(readStoredGlobalMarketsSymbol());
  }, []);

  useEffect(() => {
    const dashboardSymbol = normalizeGlobalMarketsSymbol(globalMarketsDashboard?.globalMarketsSymbol);
    if (dashboardSymbol) setAppGlobalMarketsSymbol(dashboardSymbol);
  }, [globalMarketsDashboard?.globalMarketsSymbol]);

  useEffect(() => {
    writeStoredGlobalMarketsSymbol(appGlobalMarketsSymbol);
  }, [appGlobalMarketsSymbol]);

  const scopedSymbol = activeDashboard && !GLOBAL_SYSTEM_TEMPLATE_IDS.has(activeDashboard.id)
    ? normalizeGlobalMarketsSymbol(activeDashboard.globalMarketsSymbol) : null;
  const globalMarketsSymbol = scopedSymbol ?? appGlobalMarketsSymbol;

  const setGlobalMarketsSymbolForDashboard = useCallback((symbol: string, dashboard: Dashboard) => {
    const normalized = normalizeGlobalMarketsSymbol(symbol);
    if (!normalized) return;

    if (!GLOBAL_SYSTEM_TEMPLATE_IDS.has(dashboard.id) && normalizeGlobalMarketsSymbol(dashboard.globalMarketsSymbol)) {
      if (dashboard.globalMarketsSymbol !== normalized) {
        updateDashboardRuntime(dashboard.id, { globalMarketsSymbol: normalized });
      }
      return;
    }

    setAppGlobalMarketsSymbol(normalized);
    if (globalMarketsDashboard?.id && globalMarketsDashboard.globalMarketsSymbol !== normalized) {
      updateDashboardRuntime(globalMarketsDashboard.id, { globalMarketsSymbol: normalized });
    }
  }, [globalMarketsDashboard, updateDashboardRuntime]);

  const setGlobalMarketsSymbol = useCallback((symbol: string) => {
    if (activeDashboard) {
      setGlobalMarketsSymbolForDashboard(symbol, activeDashboard);
    } else {
      const normalized = normalizeGlobalMarketsSymbol(symbol);
      if (normalized) setAppGlobalMarketsSymbol(normalized);
    }
  }, [activeDashboard, setGlobalMarketsSymbolForDashboard]);

  return (
    <GlobalMarketsSymbolContext.Provider
      value={{
        globalMarketsSymbol,
        appGlobalMarketsSymbol,
        setGlobalMarketsSymbol,
        setGlobalMarketsSymbolForDashboard,
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
