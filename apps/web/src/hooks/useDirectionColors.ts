'use client';

/**
 * useDirectionColors — resolved hex values for SVG / canvas chart fills.
 *
 * Recharts `fill`/`stroke` props and canvas contexts can't use CSS `var(...)`,
 * so charts historically hardcoded `#22c55e` / `#ef4444` for up/down. That
 * bypassed the colorblind + light-theme token system entirely.
 *
 * This hook reads the *computed* semantic CSS variables off `<html>` (which the
 * UiPreferences color-mode and ThemeContext already drive), so chart fills track
 * the same blue/orange colorblind remap and light/dark overrides as the rest of
 * the UI — without duplicating hex values in JS.
 *
 * Returns sensible static fallbacks during SSR / before mount.
 */

import { useEffect, useState } from 'react';
import { useUiPreferences } from '@/contexts/UiPreferencesContext';
import { useTheme } from '@/contexts/ThemeContext';

export interface DirectionColors {
  positive: string;
  negative: string;
  positiveMuted: string;
  negativeMuted: string;
  neutral: string;
  /** Resolve a hex for a numeric change (>0 positive, <0 negative, else neutral). */
  forValue: (value: number | null | undefined) => string;
}

// Dark-theme standard defaults (match design-tokens.css) for SSR / pre-hydration.
const FALLBACK: Omit<DirectionColors, 'forValue'> = {
  positive: '#22c55e',
  negative: '#ef4444',
  positiveMuted: '#4ade80',
  negativeMuted: '#f87171',
  neutral: '#9ca3af',
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function useDirectionColors(): DirectionColors {
  // Re-resolve whenever the color mode or theme changes.
  const { colorMode } = useUiPreferences();
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<Omit<DirectionColors, 'forValue'>>(FALLBACK);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const styles = window.getComputedStyle(document.documentElement);
    setColors({
      positive: readVar(styles, '--color-positive', FALLBACK.positive),
      negative: readVar(styles, '--color-negative', FALLBACK.negative),
      positiveMuted: readVar(styles, '--color-positive-muted', FALLBACK.positiveMuted),
      negativeMuted: readVar(styles, '--color-negative-muted', FALLBACK.negativeMuted),
      neutral: readVar(styles, '--color-neutral', FALLBACK.neutral),
    });
  }, [colorMode, resolvedTheme]);

  return {
    ...colors,
    forValue: (value) => {
      if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
        return colors.neutral;
      }
      return value > 0 ? colors.positive : colors.negative;
    },
  };
}
