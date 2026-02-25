'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { WidgetGroupId, WidgetGroupConfig, DEFAULT_GROUPS } from '@/types/widget';

const TICKER_PATTERN = /^[A-Z0-9]{3}$/;

function normalizeTickerSymbol(rawSymbol: string): string | null {
  const raw = String(rawSymbol || '').toUpperCase().trim();
  if (!raw) return null;

  const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  const candidate = tokens[0] || raw;

  if (!TICKER_PATTERN.test(candidate)) return null;
  return candidate;
}

interface WidgetGroupContextValue {
  groups: Record<WidgetGroupId, WidgetGroupConfig>;
  globalSymbol: string;
  setGlobalSymbol: (symbol: string) => void;
  setGroupSymbol: (groupId: WidgetGroupId, symbol: string) => void;
  getSymbolForGroup: (groupId: WidgetGroupId) => string;
  getColorForGroup: (groupId: WidgetGroupId) => string;
}

const WidgetGroupContext = createContext<WidgetGroupContextValue | null>(null);

const STORAGE_KEY = 'vnibb-widget-groups-v1';

export function WidgetGroupProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<Record<WidgetGroupId, WidgetGroupConfig>>(DEFAULT_GROUPS);
  const [globalSymbol, setGlobalSymbolState] = useState('VNM');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const savedGroups = localStorage.getItem(STORAGE_KEY);
    if (savedGroups) setGroups(JSON.parse(savedGroups));
    
    const savedSymbol = localStorage.getItem('vnibb-global-symbol');
    if (savedSymbol) {
      const normalized = normalizeTickerSymbol(savedSymbol);
      if (normalized) setGlobalSymbolState(normalized);
    }
    
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
      localStorage.setItem('vnibb-global-symbol', globalSymbol);
    }
  }, [globalSymbol, isLoaded]);

  const setGlobalSymbol = useCallback((symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;
    setGlobalSymbolState(normalized);
  }, []);

  const setGroupSymbol = useCallback((groupId: WidgetGroupId, symbol: string) => {
    const normalized = normalizeTickerSymbol(symbol);
    if (!normalized) return;

    if (groupId === 'global') {
      setGlobalSymbolState(normalized);
    } else {
      setGroups(prev => ({
        ...prev,
        [groupId]: { ...prev[groupId], symbol: normalized }
      }));
    }
  }, []);

  const getSymbolForGroup = useCallback((groupId: WidgetGroupId): string => {
    if (groupId === 'global') return globalSymbol;
    return groups[groupId]?.symbol || globalSymbol;
  }, [groups, globalSymbol]);

  const getColorForGroup = useCallback((groupId: WidgetGroupId): string => {
    if (groupId === 'global') return '#6366f1'; // Default indigo
    return groups[groupId]?.color || DEFAULT_GROUPS.global.color;
  }, [groups]);

  return (
    <WidgetGroupContext.Provider value={{
      groups,
      globalSymbol,
      setGlobalSymbol,
      setGroupSymbol,
      getSymbolForGroup,
      getColorForGroup,
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
