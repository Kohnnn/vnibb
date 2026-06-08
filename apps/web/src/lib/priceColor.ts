/**
 * Shared price-direction color helper.
 *
 * Single source of truth for gain/loss/neutral coloring. Components should use
 * these helpers instead of hardcoding `emerald-*`/`rose-*` Tailwind classes or
 * raw hex, so that the colorblind scheme (`[data-color-mode='colorblind']`) and
 * light-theme overrides apply consistently everywhere.
 *
 * The CSS variables are defined in `styles/design-tokens.css` and remapped for
 * light/colorblind in `app/globals.css`.
 */

export type PriceDirection = 'up' | 'down' | 'flat';

/** Classify a numeric change (or null) into a direction. */
export function priceDirection(change: number | null | undefined): PriceDirection {
  if (change === null || change === undefined || Number.isNaN(change) || change === 0) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
}

/** CSS color value (token-backed) for a direction. */
export function priceColorVar(direction: PriceDirection): string {
  switch (direction) {
    case 'up':
      return 'var(--color-positive)';
    case 'down':
      return 'var(--color-negative)';
    default:
      return 'var(--color-neutral)';
  }
}

/** CSS background value (token-backed) for a direction. */
export function priceBgVar(direction: PriceDirection): string {
  switch (direction) {
    case 'up':
      return 'var(--color-positive-bg)';
    case 'down':
      return 'var(--color-negative-bg)';
    default:
      return 'transparent';
  }
}

/**
 * Utility-class name backed by tokens. Pairs with the `.price-up`/`.price-down`/
 * `.price-flat` rules in globals.css. Prefer this in className props.
 */
export function priceColorClass(change: number | null | undefined): string {
  const dir = priceDirection(change);
  return dir === 'up' ? 'price-up' : dir === 'down' ? 'price-down' : 'price-flat';
}

/** Convenience: resolve a numeric change straight to a CSS color value. */
export function priceColor(change: number | null | undefined): string {
  return priceColorVar(priceDirection(change));
}

/** Directional glyph so direction is conveyed by shape, not color alone (a11y). */
export function priceArrow(change: number | null | undefined): string {
  const dir = priceDirection(change);
  return dir === 'up' ? '\u25B2' : dir === 'down' ? '\u25BC' : '\u2013'; // ▲ ▼ –
}
