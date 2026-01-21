'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { WidgetGroupId, WidgetGroupConfig, DEFAULT_GROUPS } from '@/types/widget';

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
  const [globalSymbol, setGlobalSymbol] = useState('VNM');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const savedGroups = localStorage.getItem(STORAGE_KEY);
    if (savedGroups) setGroups(JSON.parse(savedGroups));
    
    const savedSymbol = localStorage.getItem('vnibb-global-symbol');
    if (savedSymbol) setGlobalSymbol(savedSymbol);
    
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

  const setGroupSymbol = useCallback((groupId: WidgetGroupId, symbol: string) => {
    if (groupId === 'global') {
      setGlobalSymbol(symbol);
    } else {
      setGroups(prev => ({
        ...prev,
        [groupId]: { ...prev[groupId], symbol }
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
