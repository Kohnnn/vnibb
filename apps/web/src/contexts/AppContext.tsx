// AppContext - Unified application settings context
// Consolidates ThemeContext, UiPreferencesContext, DataSourcesContext, and UnitContext

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

export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ChartStyleDefault = 'candle' | 'bar' | 'line' | 'area';
export type DataSource = 'KBS' | 'VCI' | 'MSN' | 'FMP';
export type UnitSystem = 'metric' | 'imperial';

// ============================================================================
// Storage Keys
// ============================================================================

const THEME_KEY = 'vnibb-theme';
const DENSITY_KEY = 'vnibb-density';
const CHART_STYLE_KEY = 'vnibb-chart-style-default';
const REDUCE_EFFECTS_KEY = 'vnibb-reduce-effects';
const COLORBLIND_MODE_KEY = 'vnibb-colorblind-mode';
const VNSTOCK_SOURCE_KEY = 'vnibb_vnstock_source';
const UNIT_SYSTEM_KEY = 'vnibb-unit-system';

// ============================================================================
// Context Value
// ============================================================================

export interface AppContextValue {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'dark' | 'light';
  
  // UI Preferences
  density: Density;
  setDensity: (value: Density) => void;
  chartStyle: ChartStyleDefault;
  setChartStyle: (value: ChartStyleDefault) => void;
  reduceEffects: boolean;
  setReduceEffects: (value: boolean) => void;
  colorblindMode: boolean;
  setColorblindMode: (value: boolean) => void;
  
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
  // Theme state
  const [theme, setThemeState] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');
  
  // UI Preferences state
  const [density, setDensityState] = useState<Density>('comfortable');
  const [chartStyle, setChartStyleState] = useState<ChartStyleDefault>('candle');
  const [reduceEffects, setReduceEffectsState] = useState(false);
  const [colorblindMode, setColorblindModeState] = useState(false);
  
  // Data Sources state
  const [preferredVnstockSource, setPreferredVnstockSourceState] = useState<DataSource>('KBS');
  
  // Units state
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>('metric');

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      // Theme
      const storedTheme = localStorage.getItem(THEME_KEY);
      if (storedTheme === 'light' || storedTheme === 'dark') {
        setThemeState(storedTheme);
        setResolvedTheme(storedTheme);
      }
      
      // UI Preferences
      const storedDensity = localStorage.getItem(DENSITY_KEY);
      if (storedDensity === 'compact' || storedDensity === 'comfortable' || storedDensity === 'spacious') {
        setDensityState(storedDensity);
      }
      
      const storedChartStyle = localStorage.getItem(CHART_STYLE_KEY);
      if (storedChartStyle === 'candle' || storedChartStyle === 'bar' || storedChartStyle === 'line' || storedChartStyle === 'area') {
        setChartStyleState(storedChartStyle);
      }
      
      const storedReduceEffects = localStorage.getItem(REDUCE_EFFECTS_KEY);
      if (storedReduceEffects === 'true') setReduceEffectsState(true);
      
      const storedColorblindMode = localStorage.getItem(COLORBLIND_MODE_KEY);
      if (storedColorblindMode === 'true') setColorblindModeState(true);
      
      // Data Sources
      const storedVnstockSource = localStorage.getItem(VNSTOCK_SOURCE_KEY);
      if (storedVnstockSource === 'KBS' || storedVnstockSource === 'VCI' || 
          storedVnstockSource === 'MSN' || storedVnstockSource === 'FMP') {
        setPreferredVnstockSourceState(storedVnstockSource);
      }
      
      // Units
      const storedUnitSystem = localStorage.getItem(UNIT_SYSTEM_KEY);
      if (storedUnitSystem === 'metric' || storedUnitSystem === 'imperial') {
        setUnitSystemState(storedUnitSystem);
      }
      
      setMounted(true);
    } catch (error) {
      console.error('Failed to load app preferences:', error);
      setMounted(true);
    }
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.setAttribute('data-theme', resolvedTheme);
    
    const transitionResetTimer = setTimeout(() => {
      root.classList.remove('theme-switching');
    }, 140);
    
    return () => {
      clearTimeout(transitionResetTimer);
      root.classList.remove('theme-switching');
    };
  }, [theme, mounted, resolvedTheme]);

  // Apply UI preferences to document
  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-density', density);
  }, [density, mounted]);

  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-chart-style', chartStyle);
  }, [chartStyle, mounted]);

  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-reduce-effects', reduceEffects ? 'true' : 'false');
  }, [reduceEffects, mounted]);

  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-color-mode', colorblindMode ? 'colorblind' : 'default');
  }, [colorblindMode, mounted]);

  // Setters with localStorage persistence
  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, newTheme);
      setThemeState(newTheme);
      setResolvedTheme(newTheme);
    } catch {
      setThemeState(newTheme);
      setResolvedTheme(newTheme);
    }
  };

  const setDensity = (value: Density) => {
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch { /* ignore */ }
    setDensityState(value);
  };

  const setChartStyle = (value: ChartStyleDefault) => {
    try {
      localStorage.setItem(CHART_STYLE_KEY, value);
    } catch { /* ignore */ }
    setChartStyleState(value);
  };

  const setReduceEffects = (value: boolean) => {
    try {
      localStorage.setItem(REDUCE_EFFECTS_KEY, value ? 'true' : 'false');
    } catch { /* ignore */ }
    setReduceEffectsState(value);
  };

  const setColorblindMode = (value: boolean) => {
    try {
      localStorage.setItem(COLORBLIND_MODE_KEY, value ? 'true' : 'false');
    } catch { /* ignore */ }
    setColorblindModeState(value);
  };

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
    theme,
    setTheme,
    resolvedTheme,
    density,
    setDensity,
    chartStyle,
    setChartStyle,
    reduceEffects,
    setReduceEffects,
    colorblindMode,
    setColorblindMode,
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
export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useApp();
  return { theme, setTheme, resolvedTheme };
}

export function useUiPreferences() {
  const {
    density, setDensity,
    chartStyle, setChartStyle,
    reduceEffects, setReduceEffects,
    colorblindMode, setColorblindMode,
  } = useApp();
  return {
    density, setDensity,
    chartStyle, setChartStyle,
    reduceEffects, setReduceEffects,
    colorblindMode, setColorblindMode,
  };
}

export function useDataSourcePreference() {
  const { preferredVnstockSource, setPreferredVnstockSource } = useApp();
  return { preferredVnstockSource, setPreferredVnstockSource };
}

export function useUnitSystem() {
  const { unitSystem, setUnitSystem } = useApp();
  return { unitSystem, setUnitSystem };
}
