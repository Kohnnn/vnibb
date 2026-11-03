import { formatScreenerValue } from '@/utils/formatters';
import { formatDividendYield, formatRatio } from './formatters';

// Screener percent/change fields arrive in percentage points: a 0.75% move is
// `0.75`. Rendering them through `input: 'auto'` rescaled anything under 1 into
// 75%, which is a hundredfold error in a financial table.
test('screener change keeps percentage-point scale', () => {
  expect(formatScreenerValue(-0.75, 'change')).toBe('-0.75%');
  expect(formatScreenerValue(1.25, 'change')).toBe('+1.25%');
  expect(formatScreenerValue(-2.5, 'change')).toBe('-2.50%');
  expect(formatScreenerValue(0, 'change')).toBe('0.00%');
  expect(formatScreenerValue(null, 'change')).toBe('n/a');
});

test('screener percent does not rescale sub-1 values', () => {
  expect(formatScreenerValue(0.75, 'percent')).toBe('0.75%');
  expect(formatScreenerValue(15.2, 'percent')).toBe('15.20%');
});

// Brand v1.1: `n/a` is unavailable, `n/m` is not meaningful, and a hyphen is
// neither. A missing ratio used to render `-`, which reads as a measured value.
test('missing ratios read n/a, not a hyphen', () => {
  expect(formatRatio(null)).toBe('n/a');
  expect(formatRatio(undefined)).toBe('n/a');
  expect(formatRatio(Number.NaN)).toBe('n/a');
  expect(formatRatio(12.345)).toBe('12.35');
});

test('dividend yield separates unavailable from not meaningful', () => {
  expect(formatDividendYield(null)).toBe('n/a');
  expect(formatDividendYield(-1)).toBe('n/m');
  expect(formatDividendYield(2.5)).toBe('2.50%');
});
