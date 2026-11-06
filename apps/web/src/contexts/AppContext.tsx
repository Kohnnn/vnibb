// AppContext - data-source and unit preferences.
//
// Theme lives in ThemeContext and UI preferences (density, chart style,
// reduce-effects, colorblind mode) live in UiPreferencesContext. This provider
// used to hold duplicates of both and write the same root attributes, so two
// providers raced to set `data-theme`/`data-density`/`data-reduce-effects` and
// whichever mounted last won. It no longer owns either.

'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// ============================================================================
// Types
// ============================================================================

export type DataSource = 'VCI';
export type UnitSystem = 'metric' | 'imperial';

// ============================================================================
// Storage Keys
// ============================================================================

const VNSTOCK_SOURCE_KEY = 'vnibb_vnstock_source';
const UNIT_SYSTEM_KEY = 'vnibb-unit-system';

// ============================================================================
// Context Value
// ============================================================================

export interface AppContextValue {
  // Data Sources
  preferredVnstockSource: DataSource;
  setPreferredVnstockSource: (source: DataSource) => void;

  // Units
  unitSystem: UnitSystem;
  setUnitSystem: (system: UnitSystem) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [preferredVnstockSource, setPreferredVnstockSourceState] = useState<DataSource>('VCI');
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>('metric');

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      // Data Sources
      localStorage.setItem(VNSTOCK_SOURCE_KEY, 'VCI');

      // Units
      const storedUnitSystem = localStorage.getItem(UNIT_SYSTEM_KEY);
      if (storedUnitSystem === 'metric' || storedUnitSystem === 'imperial') {
        setUnitSystemState(storedUnitSystem);
      }
    } catch (error) {
      console.error('Failed to load app preferences:', error);
    }
  }, []);

  const setPreferredVnstockSource = (source: DataSource) => {
    try {
      localStorage.setItem(VNSTOCK_SOURCE_KEY, source);
    } catch { /* ignore */ }
    setPreferredVnstockSourceState(source);
  };

  const setUnitSystem = (system: UnitSystem) => {
    try {
      localStorage.setItem(UNIT_SYSTEM_KEY, system);
    } catch { /* ignore */ }
    setUnitSystemState(system);
  };

  const value: AppContextValue = {
    preferredVnstockSource,
    setPreferredVnstockSource,
    unitSystem,
    setUnitSystem,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

// Convenience hooks
export function useDataSourcePreference() {
  const { preferredVnstockSource, setPreferredVnstockSource } = useApp();
  return { preferredVnstockSource, setPreferredVnstockSource };
}

export function useUnitSystem() {
  const { unitSystem, setUnitSystem } = useApp();
  return { unitSystem, setUnitSystem };
}
