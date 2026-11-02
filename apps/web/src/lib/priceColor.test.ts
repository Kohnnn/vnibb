/**
 * #198: missing is not flat. A null/undefined change must not be coloured or
 * arrowed like a measured zero, and direction must survive colour-vision mode
 * through the arrow glyph rather than hue alone.
 */
import { priceArrow, priceColorClass, priceDirection } from './priceColor'

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
