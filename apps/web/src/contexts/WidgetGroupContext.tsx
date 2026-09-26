'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { DEFAULT_TICKER, normalizeTickerSymbol, readStoredTicker, writeStoredTicker } from '@/lib/defaultTicker';
import { WidgetGroupId, WidgetGroupConfig, DEFAULT_GROUPS } from '@/types/widget';
import { useDashboard } from '@/contexts/DashboardContext';

interface WidgetGroupContextValue {
  getSharedGroups: () => Record<WidgetGroupId, WidgetGroupConfig>;
  groups: Record<WidgetGroupId, WidgetGroupConfig>;
  globalSymbol: string;
  setGlobalSymbol: (symbol: string) => void;
  setGroupSymbol: (groupId: WidgetGroupId, symbol: string) => void;
  getSymbolForGroup: (groupId: WidgetGroupId) => string;
  getColorForGroup: (groupId: WidgetGroupId) => string;
  /** A widget's own ticker when it is detached from group sync, else null. */
  tickerOverrideFor: (widgetId: string) => string | null;
  setWidgetTickerOverride: (widgetId: string, symbol: string) => void;
  clearWidgetTickerOverride: (widgetId: string) => void;
}

const WidgetGroupContext = createContext<WidgetGroupContextValue | null>(null);

const STORAGE_KEY = 'vnibb-widget-groups-v1';

export function WidgetGroupProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<Record<WidgetGroupId, WidgetGroupConfig>>(DEFAULT_GROUPS);
  const [globalSymbol, setGlobalSymbolState] = useState(DEFAULT_TICKER);
  const [isLoaded, setIsLoaded] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const { activeDashboard, updateDashboardRuntime } = useDashboard();
  const workspaceGroups = activeDashboard?.widgetGroups;
  const effectiveGroups = workspaceGroups ?? groups;
  const effectiveGlobalSymbol = workspaceGroups?.global.symbol ?? globalSymbol;

  // Load from localStorage on mount
  useEffect(() => {
    const savedGroups = localStorage.getItem(STORAGE_KEY);
    if (savedGroups) setGroups(JSON.parse(savedGroups));
    
    setGlobalSymbolState(readStoredTicker());
    
    setIsLoaded(true);
  }, []);

  // Persist changes (only after initial load)
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
    }
  }, [groups, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      writeStoredTicker(globalSymbol);
    }
  }, [globalSymbol, isLoaded]);

  const setGlobalSymbol = useCallback((symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;
    if (activeDashboard?.widgetGroups) {
      updateDashboardRuntime(activeDashboard.id, { widgetGroups: {
        ...activeDashboard.widgetGroups,
        global: { ...activeDashboard.widgetGroups.global, symbol: normalized },
      } });
      return;
    }
    setGlobalSymbolState(normalized);
  }, [activeDashboard, updateDashboardRuntime]);

  const setGroupSymbol = useCallback((groupId: WidgetGroupId, symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;
    if (activeDashboard?.widgetGroups) {
      updateDashboardRuntime(activeDashboard.id, { widgetGroups: {
        ...activeDashboard.widgetGroups,
        [groupId]: { ...activeDashboard.widgetGroups[groupId], symbol: normalized },
      } });
      return;
    }

    if (groupId === 'global') {
      setGlobalSymbolState(normalized);
    } else {
      setGroups(prev => ({
        ...prev,
        [groupId]: { ...prev[groupId], symbol: normalized }
      }));
    }
  }, [activeDashboard, updateDashboardRuntime]);

  const getSymbolForGroup = useCallback((groupId: WidgetGroupId): string => {
    if (groupId === 'global') return effectiveGlobalSymbol;
    return effectiveGroups[groupId]?.symbol || effectiveGlobalSymbol;
  }, [effectiveGroups, effectiveGlobalSymbol]);

  const getColorForGroup = useCallback((groupId: WidgetGroupId): string => {
    return effectiveGroups[groupId]?.color || DEFAULT_GROUPS.global.color;
  }, [effectiveGroups]);

  const getSharedGroups = useCallback(() => ({
    ...groups,
    global: { ...groups.global, symbol: globalSymbol },
  }), [groups, globalSymbol]);

  /**
   * Detach a widget from its group's ticker. The widget stays in the group but
   * keeps its own ticker until the user resets it.
   */
  const setWidgetTickerOverride = useCallback((widgetId: string, symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;
    setOverrides((prev) => ({ ...prev, [widgetId]: normalized }));
  }, []);

  /** Clear an override so the widget follows its group again. */
  const clearWidgetTickerOverride = useCallback((widgetId: string) => {
    setOverrides((prev) => {
      if (!(widgetId in prev)) return prev;
      const next = { ...prev };
      delete next[widgetId];
      return next;
    });
  }, []);

  const tickerOverrideFor = useCallback(
    (widgetId: string): string | null => overrides[widgetId] ?? null,
    [overrides],
  );

  return (
    <WidgetGroupContext.Provider value={{
      groups: effectiveGroups,
      globalSymbol: effectiveGlobalSymbol,
      getSharedGroups,
      setGlobalSymbol,
      setGroupSymbol,
      getSymbolForGroup,
      getColorForGroup,
      setWidgetTickerOverride,
      clearWidgetTickerOverride,
      tickerOverrideFor,
    }}>
      {children}
    </WidgetGroupContext.Provider>
  );
}

export function useWidgetGroups() {
  const context = useContext(WidgetGroupContext);
  if (!context) {
    throw new Error('useWidgetGroups must be used within WidgetGroupProvider');
  }
  return context;
}
