'use client';

/**
 * UI preferences (density + chart-style defaults + accessibility).
 *
 * Kept separate from `ThemeContext` because these affect widget rendering and
 * accessibility rather than the colour palette itself, and we want to persist /
 * migrate them independently. Values are persisted to localStorage and applied
 * to `document.documentElement` as data attributes so CSS can react via
 * `:root[data-density='compact']`, `:root[data-reduce-effects='true']`, etc.
 */

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type ChartStyleDefault = 'candle' | 'bar' | 'line' | 'area';

interface UiPreferencesContextType {
  density: Density;
  setDensity: (value: Density) => void;
  chartStyle: ChartStyleDefault;
  setChartStyle: (value: ChartStyleDefault) => void;
  reduceEffects: boolean;
  setReduceEffects: (value: boolean) => void;
  colorblindMode: boolean;
  setColorblindMode: (value: boolean) => void;
}

const UiPreferencesContext = createContext<UiPreferencesContextType | undefined>(
  undefined,
);

const DENSITY_KEY = 'vnibb-density';
const CHART_STYLE_KEY = 'vnibb-chart-style-default';
const REDUCE_EFFECTS_KEY = 'vnibb-reduce-effects';
const COLORBLIND_MODE_KEY = 'vnibb-colorblind-mode';

const isDensity = (value: unknown): value is Density =>
  value === 'compact' || value === 'comfortable' || value === 'spacious';

const isChartStyle = (value: unknown): value is ChartStyleDefault =>
  value === 'candle' || value === 'bar' || value === 'line' || value === 'area';

const handleStorageError = (message: string, error: unknown) => {
  if (error instanceof DOMException) {
    console.warn(message, error);
    return;
  }

  throw error;
};

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');
  const [chartStyle, setChartStyleState] = useState<ChartStyleDefault>('candle');
  const [reduceEffects, setReduceEffectsState] = useState<boolean>(false);
  const [colorblindMode, setColorblindModeState] = useState<boolean>(false);

  useEffect(() => {
    try {
      const storedDensity = localStorage.getItem(DENSITY_KEY);
      if (isDensity(storedDensity)) {
        setDensityState(storedDensity);
      }

      const storedChartStyle = localStorage.getItem(CHART_STYLE_KEY);
      if (isChartStyle(storedChartStyle)) {
        setChartStyleState(storedChartStyle);
      }

      const storedReduceEffects = localStorage.getItem(REDUCE_EFFECTS_KEY);
      if (storedReduceEffects === 'true' || storedReduceEffects === 'false') {
        setReduceEffectsState(storedReduceEffects === 'true');
      }

      const storedColorblindMode = localStorage.getItem(COLORBLIND_MODE_KEY);
      if (storedColorblindMode === 'true' || storedColorblindMode === 'false') {
        setColorblindModeState(storedColorblindMode === 'true');
      }
    } catch (error) {
      handleStorageError('Failed to read UI preferences from localStorage:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-chart-style', chartStyle);
  }, [chartStyle]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-reduce-effects',
      reduceEffects ? 'true' : 'false',
    );
  }, [reduceEffects]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-color-mode',
      colorblindMode ? 'colorblind' : 'default',
    );
  }, [colorblindMode]);

  const setDensity = (value: Density) => {
    setDensityState(value);
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch (error) {
      handleStorageError('Failed to persist density preference:', error);
    }
  };

  const setChartStyle = (value: ChartStyleDefault) => {
    setChartStyleState(value);
    try {
      localStorage.setItem(CHART_STYLE_KEY, value);
    } catch (error) {
      handleStorageError('Failed to persist chart-style preference:', error);
    }
  };

  const setReduceEffects = (value: boolean) => {
    setReduceEffectsState(value);
    try {
      localStorage.setItem(REDUCE_EFFECTS_KEY, value ? 'true' : 'false');
    } catch (error) {
      handleStorageError('Failed to persist reduce-effects preference:', error);
    }
  };

  const setColorblindMode = (value: boolean) => {
    setColorblindModeState(value);
    try {
      localStorage.setItem(COLORBLIND_MODE_KEY, value ? 'true' : 'false');
    } catch (error) {
      handleStorageError('Failed to persist colorblind-mode preference:', error);
    }
  };

  return (
    <UiPreferencesContext.Provider
      value={{
        density,
        setDensity,
        chartStyle,
        setChartStyle,
        reduceEffects,
        setReduceEffects,
        colorblindMode,
        setColorblindMode,
      }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextType {
  const context = useContext(UiPreferencesContext);
  if (context === undefined) {
    // Safe fallback for components rendered outside the provider (e.g. some
    // test harnesses). Returns defaults and no-op setters so downstream
    // code can render without crashing.
    return {
      density: 'comfortable',
      setDensity: () => undefined,
      chartStyle: 'candle',
      setChartStyle: () => undefined,
      reduceEffects: false,
      setReduceEffects: () => undefined,
      colorblindMode: false,
      setColorblindMode: () => undefined,
    };
  }
  return context;
}

/**
 * Pre-hydration script that applies stored density + chart-style +
 * reduce-effects attributes to `document.documentElement` so CSS doesn't have to
 * wait for React to settle (avoids FOUC). Mount alongside `ThemeScript` in the
 * root layout.
 */
export const UiPreferencesScript = () => {
  const script = `
    (function() {
      try {
        var density = localStorage.getItem('${DENSITY_KEY}');
        if (density === 'compact' || density === 'comfortable' || density === 'spacious') {
          document.documentElement.setAttribute('data-density', density);
        }
        var chartStyle = localStorage.getItem('${CHART_STYLE_KEY}');
        if (chartStyle === 'candle' || chartStyle === 'bar' || chartStyle === 'line' || chartStyle === 'area') {
          document.documentElement.setAttribute('data-chart-style', chartStyle);
        }
        var reduceEffects = localStorage.getItem('${REDUCE_EFFECTS_KEY}');
        if (reduceEffects === 'true' || reduceEffects === 'false') {
          document.documentElement.setAttribute('data-reduce-effects', reduceEffects);
        }
        var colorblindMode = localStorage.getItem('${COLORBLIND_MODE_KEY}');
        if (colorblindMode === 'true' || colorblindMode === 'false') {
          document.documentElement.setAttribute('data-color-mode', colorblindMode === 'true' ? 'colorblind' : 'default');
        }
      } catch (e) {
        // ignore
      }
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
};
