'use client';

/**
 * UI preferences (density + chart-style defaults).
 *
 * Kept separate from `ThemeContext` because density and chart style affect
 * widget rendering rather than colour palette, and we want to be able to
 * persist / migrate them independently. Values are persisted to
 * localStorage and applied to `document.documentElement` as data
 * attributes so CSS can react via `:root[data-density='compact']` etc.
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
}

const UiPreferencesContext = createContext<UiPreferencesContextType | undefined>(
  undefined,
);

const DENSITY_KEY = 'vnibb-density';
const CHART_STYLE_KEY = 'vnibb-chart-style-default';

const isDensity = (value: unknown): value is Density =>
  value === 'compact' || value === 'comfortable' || value === 'spacious';

const isChartStyle = (value: unknown): value is ChartStyleDefault =>
  value === 'candle' || value === 'bar' || value === 'line' || value === 'area';

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');
  const [chartStyle, setChartStyleState] = useState<ChartStyleDefault>('candle');

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
    } catch (error) {
      // localStorage unavailable (e.g. SSR / private mode); silently fall
      // back to defaults rather than blocking render.
      console.warn('Failed to read UI preferences from localStorage:', error);
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

  const setDensity = (value: Density) => {
    setDensityState(value);
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch (error) {
      console.warn('Failed to persist density preference:', error);
    }
  };

  const setChartStyle = (value: ChartStyleDefault) => {
    setChartStyleState(value);
    try {
      localStorage.setItem(CHART_STYLE_KEY, value);
    } catch (error) {
      console.warn('Failed to persist chart-style preference:', error);
    }
  };

  return (
    <UiPreferencesContext.Provider
      value={{ density, setDensity, chartStyle, setChartStyle }}
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
    };
  }
  return context;
}

/**
 * Pre-hydration script that applies stored density + chart-style classes to
 * `document.documentElement` so CSS doesn't have to wait for React to
 * settle. Mount alongside `ThemeScript` in the root layout.
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
