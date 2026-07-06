'use client';

/**
 * Colorblind-safe semantic palette re-export.
 *
 * The canonical helpers live in `@/lib/colorblind` (`useColorblind`,
 * `colorblindClass`). We re-export them here so widgets inside the
 * `prediction-market-ui/` folder can import from a single relative path.
 */

export { useColorblind, colorblindClass } from '@/lib/colorblind';

export type ColorblindIntent = 'positive' | 'negative' | 'warning';