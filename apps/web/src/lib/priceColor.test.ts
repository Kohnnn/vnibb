/**
 * #198: missing is not flat. A null/undefined change must not be coloured or
 * arrowed like a measured zero, and direction must survive colour-vision mode
 * through the arrow glyph rather than hue alone.
 */
import { priceArrow, priceColorClass, priceDirection, signedToneClass } from './priceColor'

describe('price direction', () => {
  it.each([
    [null, 'none'],
    [undefined, 'none'],
    [Number.NaN, 'none'],
    [Number.POSITIVE_INFINITY, 'none'],
    [0, 'flat'],
    [-0, 'flat'],
    [1.25, 'up'],
    [-1.25, 'down'],
  ] as const)('classifies %s as %s', (change, expected) => {
    expect(priceDirection(change)).toBe(expected)
  })

  it('keeps missing values out of the gain/loss/flat classes', () => {
    expect(priceColorClass(null)).toBe('price-missing')
    expect(priceColorClass(0)).toBe('price-flat')
    expect(priceColorClass(2)).toBe('price-up')
    expect(priceColorClass(-2)).toBe('price-down')
  })

  it('gives every state a distinct shape so hue is never the only signal', () => {
    expect(priceArrow(1)).toBe('\u25B2')
    expect(priceArrow(-1)).toBe('\u25BC')
    expect(priceArrow(0)).toBe('\u2013')
    expect(priceArrow(null)).toBe('')
  })
})

describe('signed tone', () => {
  // Brand §13 financialSemantics: zero is `ink`, not a gain. `change >= 0 ?
  // gain : loss` is the shape this replaces, so it must not come back.
  it('reserves gain and loss for measured direction', () => {
    expect(signedToneClass(1.2)).toBe('text-[var(--color-positive)]')
    expect(signedToneClass(-1.2)).toBe('text-[var(--color-negative)]')
  })

  it('renders a measured zero in ink, not gain', () => {
    expect(signedToneClass(0)).toBe('text-[var(--text-primary)]')
    expect(signedToneClass(-0)).toBe('text-[var(--text-primary)]')
  })

  it('renders a missing reading muted, not as a loss', () => {
    expect(signedToneClass(null)).toBe('text-[var(--text-muted)]')
    expect(signedToneClass(undefined)).toBe('text-[var(--text-muted)]')
    expect(signedToneClass(Number.NaN)).toBe('text-[var(--text-muted)]')
  })
})
