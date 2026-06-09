'use client';

/**
 * useDirectionColors — resolved hex values for SVG / canvas chart fills.
 *
 * Recharts `fill`/`stroke` props and canvas contexts can't use CSS `var(...)`,
 * so charts historically hardcoded `#22c55e` / `#ef4444` for up/down. That
 * bypassed the semantic + light-theme token system entirely.
 *
 * This hook reads the *computed* semantic CSS variables off `<html>` (driven by
 * ThemeContext), so chart fills track the same up/down tokens and light/dark
 * overrides as the rest of the UI — without duplicating hex values in JS.
 *
 * Returns sensible static fallbacks during SSR / before mount.
 */

import { useEffect, useState } from 'react';
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
  positive: '#2ee06a',
  negative: '#ff5a5a',
  positiveMuted: '#6ee79a',
  negativeMuted: '#ff8a8a',
  neutral: '#9ca3af',
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function useDirectionColors(): DirectionColors {
  // Re-resolve whenever the theme changes.
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
  }, [resolvedTheme]);

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
