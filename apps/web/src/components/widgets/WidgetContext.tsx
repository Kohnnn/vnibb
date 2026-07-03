// Widget Context - Provides widget-level state management

'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { WidgetHealthStatus } from './types';

export interface WidgetContextValue {
  // Symbol
  symbol: string;
  setSymbol: (symbol: string) => void;
  
  // Widget state
  isMaximized: boolean;
  setIsMaximized: (maximized: boolean) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  // Health status
  healthStatus: WidgetHealthStatus;
  setHealthStatus: (status: WidgetHealthStatus) => void;
  lastUpdated: Date | null;
  setLastUpdated: (date: Date) => void;
  
  // Error state
  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;
  
  // Widget data
  widgetData: unknown;
  setWidgetData: (data: unknown) => void;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

interface WidgetProviderProps {
  children: ReactNode;
  initialSymbol?: string;
}

export function WidgetProvider({ children, initialSymbol }: WidgetProviderProps) {
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<WidgetHealthStatus>('unknown');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widgetData, setWidgetData] = useState<unknown>(null);

  const clearError = useCallback(() => setError(null), []);

  const value: WidgetContextValue = {
    symbol,
    setSymbol,
    isMaximized,
    setIsMaximized,
    isCollapsed,
    setIsCollapsed,
    isLoading,
    setIsLoading,
    healthStatus,
    setHealthStatus,
    lastUpdated,
    setLastUpdated,
    error,
    setError,
    clearError,
    widgetData,
    setWidgetData,
  };

  return (
    <WidgetContext.Provider value={value}>
      {children}
    </WidgetContext.Provider>
  );
}

export function useWidget() {
  const context = useContext(WidgetContext);
  if (!context) {
    throw new Error('useWidget must be used within a WidgetProvider');
  }
  return context;
}

// Convenience hooks
export function useWidgetSymbol() {
  const { symbol, setSymbol } = useWidget();
  return { symbol, setSymbol };
}

export function useWidgetState() {
  const { isMaximized, isCollapsed, isLoading } = useWidget();
  return { isMaximized, isCollapsed, isLoading };
}

export function useWidgetHealth() {
  const { healthStatus, lastUpdated, error } = useWidget();
  return { healthStatus, lastUpdated, error };
}
