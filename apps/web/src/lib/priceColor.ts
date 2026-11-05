/**
 * Shared price-direction color helper.
 *
 * Single source of truth for gain/loss/neutral coloring. Components should use
 * these helpers instead of hardcoding `emerald-*`/`rose-*` Tailwind classes or
 * raw hex, so that the light-theme overrides apply consistently everywhere.
 *
 * The CSS variables are defined in `styles/design-tokens.css` and overridden for
 * light theme in `app/globals.css`.
 */

/**
 * Direction of a measured change, or `none` when there is no measurement.
 *
 * `none` (null / undefined / non-finite) is not the same state as `flat` (a
 * measured zero): a missing value must render `n/a` and never get a direction
 * colour or arrow. Collapsing the two is what made missing prices look flat.
 */
export type PriceDirection = 'up' | 'down' | 'flat' | 'none';

/** Classify a numeric change (or null) into a direction. */
export function priceDirection(change: number | null | undefined): PriceDirection {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return 'none';
  }
  if (change === 0) return 'flat';
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
 * CSS background for a signed bar/meter fill: gain, loss, and the neutral
 * token for both a measured zero and a missing reading. Use this instead of
 * `value >= 0 ? positive : negative`, which paints a zero as a gain and a
 * missing value as a loss.
 */
export function colorForDirection(change: number | null | undefined): string {
  const dir = priceDirection(change);
  if (dir === 'up' || dir === 'down') return priceBgVar(dir);
  // Brand §13: a measured zero is ink, i.e. the neutral family, not a gain tint.
  return dir === 'flat' ? 'color-mix(in srgb, var(--color-neutral) 20%, transparent)' : 'transparent';
}

/**
 * Utility-class name backed by tokens. Pairs with the `.price-up`/`.price-down`/
 * `.price-flat` rules in globals.css. Prefer this in className props.
 */
export function priceColorClass(change: number | null | undefined): string {
  const dir = priceDirection(change);
  if (dir === 'none') return 'price-missing';
  return dir === 'up' ? 'price-up' : dir === 'down' ? 'price-down' : 'price-flat';
}

/** Convenience: resolve a numeric change straight to a CSS color value. */
export function priceColor(change: number | null | undefined): string {
  return priceColorVar(priceDirection(change));
}

/**
 * Text class for a signed figure: gain, loss, ink for a measured zero and muted
 * for a missing reading (brand §13 `financialSemantics`: zero is `ink`).
 *
 * Use this instead of `change >= 0 ? gain : loss`, which paints a real zero as
 * a gain and a null as a loss.
 */
export function signedToneClass(change: number | null | undefined): string {
  const dir = priceDirection(change);
  if (dir === 'none') return 'text-[var(--text-muted)]';
  if (dir === 'flat') return 'text-[var(--text-primary)]';
  return dir === 'up' ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]';
}


/**
 * Directional glyph so direction is conveyed by shape, not color alone (a11y).
 * Missing values get an empty string: `n/a` already says there is no reading,
 * and a dash would read as a measured flat.
 */
export function priceArrow(change: number | null | undefined): string {
  const dir = priceDirection(change);
  if (dir === 'none') return '';
  return dir === 'up' ? '\u25B2' : dir === 'down' ? '\u25BC' : '\u2013'; // ▲ ▼ –
}
