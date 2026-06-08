'use client';

/**
 * UI preferences (density + chart-style defaults + accessibility).
 *
 * Kept separate from `ThemeContext` because these affect widget rendering and
 * accessibility rather than the colour palette itself, and we want to persist /
 * migrate them independently. Values are persisted to localStorage and applied
 * to `document.documentElement` as data attributes so CSS can react via
 * `:root[data-density='compact']`, `:root[data-color-mode='colorblind']`,
 * `:root[data-reduce-effects='true']`, etc.
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
export type ColorMode = 'standard' | 'colorblind';

interface UiPreferencesContextType {
  density: Density;
  setDensity: (value: Density) => void;
  chartStyle: ChartStyleDefault;
  setChartStyle: (value: ChartStyleDefault) => void;
  colorMode: ColorMode;
  setColorMode: (value: ColorMode) => void;
  reduceEffects: boolean;
  setReduceEffects: (value: boolean) => void;
}

const UiPreferencesContext = createContext<UiPreferencesContextType | undefined>(
  undefined,
);

const DENSITY_KEY = 'vnibb-density';
const CHART_STYLE_KEY = 'vnibb-chart-style-default';
const COLOR_MODE_KEY = 'vnibb-color-mode';
const REDUCE_EFFECTS_KEY = 'vnibb-reduce-effects';

const isDensity = (value: unknown): value is Density =>
  value === 'compact' || value === 'comfortable' || value === 'spacious';

const isChartStyle = (value: unknown): value is ChartStyleDefault =>
  value === 'candle' || value === 'bar' || value === 'line' || value === 'area';

const isColorMode = (value: unknown): value is ColorMode =>
  value === 'standard' || value === 'colorblind';

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');
  const [chartStyle, setChartStyleState] = useState<ChartStyleDefault>('candle');
  const [colorMode, setColorModeState] = useState<ColorMode>('standard');
  const [reduceEffects, setReduceEffectsState] = useState<boolean>(false);

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

      const storedColorMode = localStorage.getItem(COLOR_MODE_KEY);
      if (isColorMode(storedColorMode)) {
        setColorModeState(storedColorMode);
      }

      const storedReduceEffects = localStorage.getItem(REDUCE_EFFECTS_KEY);
      if (storedReduceEffects === 'true' || storedReduceEffects === 'false') {
        setReduceEffectsState(storedReduceEffects === 'true');
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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-color-mode', colorMode);
  }, [colorMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-reduce-effects',
      reduceEffects ? 'true' : 'false',
    );
  }, [reduceEffects]);

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

  const setColorMode = (value: ColorMode) => {
    setColorModeState(value);
    try {
      localStorage.setItem(COLOR_MODE_KEY, value);
    } catch (error) {
      console.warn('Failed to persist color-mode preference:', error);
    }
  };

  const setReduceEffects = (value: boolean) => {
    setReduceEffectsState(value);
    try {
      localStorage.setItem(REDUCE_EFFECTS_KEY, value ? 'true' : 'false');
    } catch (error) {
      console.warn('Failed to persist reduce-effects preference:', error);
    }
  };

  return (
    <UiPreferencesContext.Provider
      value={{
        density,
        setDensity,
        chartStyle,
        setChartStyle,
        colorMode,
        setColorMode,
        reduceEffects,
        setReduceEffects,
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
      colorMode: 'standard',
      setColorMode: () => undefined,
      reduceEffects: false,
      setReduceEffects: () => undefined,
    };
  }
  return context;
}

/**
 * Pre-hydration script that applies stored density + chart-style + color-mode +
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
        var colorMode = localStorage.getItem('${COLOR_MODE_KEY}');
        if (colorMode === 'standard' || colorMode === 'colorblind') {
          document.documentElement.setAttribute('data-color-mode', colorMode);
        }
        var reduceEffects = localStorage.getItem('${REDUCE_EFFECTS_KEY}');
        if (reduceEffects === 'true' || reduceEffects === 'false') {
          document.documentElement.setAttribute('data-reduce-effects', reduceEffects);
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
