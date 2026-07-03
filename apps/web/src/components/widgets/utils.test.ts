import {
  toPositiveNumber,
  toNumber,
  firstFinite,
  firstPositiveNumber,
  resolveMetric,
  clampPercent,
  getChangeDirection,
} from '@/components/widgets/utils';

describe('widget utils', () => {
  describe('toPositiveNumber', () => {
    test('returns the number when it is a positive finite number', () => {
      expect(toPositiveNumber(42)).toBe(42);
      expect(toPositiveNumber(0.001)).toBeCloseTo(0.001);
      expect(toPositiveNumber(1e10)).toBe(1e10);
    });

    test('returns null for non-positive values', () => {
      expect(toPositiveNumber(0)).toBeNull();
      expect(toPositiveNumber(-5)).toBeNull();
    });

    test('returns null for non-finite values', () => {
      expect(toPositiveNumber(NaN)).toBeNull();
      expect(toPositiveNumber(Infinity)).toBeNull();
      expect(toPositiveNumber(-Infinity)).toBeNull();
    });

    test('returns null for non-numeric input', () => {
      expect(toPositiveNumber('hello')).toBeNull();
      expect(toPositiveNumber(null)).toBeNull();
      expect(toPositiveNumber(undefined)).toBeNull();
      expect(toPositiveNumber({})).toBeNull();
    });

    test('parses numeric strings', () => {
      expect(toPositiveNumber('123')).toBe(123);
      expect(toPositiveNumber('3.14')).toBeCloseTo(3.14);
    });
  });

  describe('toNumber', () => {
    test('returns the number when finite', () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber(-5.5)).toBe(-5.5);
      expect(toNumber(0)).toBe(0);
    });

    test('returns null for non-finite values', () => {
      expect(toNumber(NaN)).toBeNull();
      expect(toNumber(Infinity)).toBeNull();
      expect(toNumber(-Infinity)).toBeNull();
    });

    test('returns null for non-numeric input', () => {
      expect(toNumber('hello')).toBeNull();
      expect(toNumber(null)).toBeNull();
      expect(toNumber(undefined)).toBeNull();
    });

    test('parses numeric strings including zero and negatives', () => {
      expect(toNumber('0')).toBe(0);
      expect(toNumber('-3.5')).toBe(-3.5);
    });
  });

  describe('firstFinite', () => {
    test('returns the first finite number', () => {
      expect(firstFinite(1, 2, 3)).toBe(1);
      expect(firstFinite(null, undefined, 5, 6)).toBe(5);
      expect(firstFinite(NaN, Infinity, 7)).toBe(7);
    });

    test('skips null and undefined', () => {
      expect(firstFinite(null, undefined)).toBeNull();
    });

    test('returns null when no finite number is found', () => {
      expect(firstFinite(null, undefined, NaN)).toBeNull();
    });

    test('handles mixed types', () => {
      expect(firstFinite(null, -2.5, 10)).toBe(-2.5);
    });
  });

  describe('firstPositiveNumber', () => {
    test('returns the first positive number', () => {
      expect(firstPositiveNumber(1, 2, 3)).toBe(1);
      expect(firstPositiveNumber(-1, 0, 5)).toBe(5);
    });

    test('skips non-positive values', () => {
      expect(firstPositiveNumber(0, -5, 10)).toBe(10);
    });

    test('returns null when no positive number is found', () => {
      expect(firstPositiveNumber(0, -1, 'hello')).toBeNull();
    });
  });

  describe('resolveMetric', () => {
    test('returns the first candidate with a valid number', () => {
      const result = resolveMetric([
        { value: null, source: 'A' },
        { value: 42, source: 'B' },
        { value: 99, source: 'C' },
      ]);
      expect(result).toEqual({ value: 42, source: 'B' });
    });

    test('skips candidates that fail to parse', () => {
      const result = resolveMetric([
        { value: 'hello', source: 'A' },
        { value: 7, source: 'B' },
      ]);
      expect(result).toEqual({ value: 7, source: 'B' });
    });

    test('respects positiveOnly and skips zero/negative', () => {
      const result = resolveMetric([
        { value: 0, source: 'A', positiveOnly: true },
        { value: -5, source: 'B', positiveOnly: true },
        { value: 3.5, source: 'C', positiveOnly: true },
      ]);
      expect(result).toEqual({ value: 3.5, source: 'C' });
    });

    test('returns Unavailable when no candidates resolve', () => {
      const result = resolveMetric([
        { value: null, source: 'A' },
        { value: 'nope', source: 'B' },
        { value: NaN, source: 'C' },
      ]);
      expect(result).toEqual({ value: null, source: 'Unavailable' });
    });
  });

  describe('clampPercent', () => {
    test('returns the value when already in [0, 100]', () => {
      expect(clampPercent(50)).toBe(50);
      expect(clampPercent(0)).toBe(0);
      expect(clampPercent(100)).toBe(100);
    });

    test('clamps values below 0 to 0', () => {
      expect(clampPercent(-10)).toBe(0);
      expect(clampPercent(-1e9)).toBe(0);
    });

    test('clamps values above 100 to 100', () => {
      expect(clampPercent(150)).toBe(100);
      expect(clampPercent(1e9)).toBe(100);
    });

    test('returns 0 for non-finite input', () => {
      expect(clampPercent(NaN)).toBe(0);
      expect(clampPercent(Infinity)).toBe(0);
      expect(clampPercent(-Infinity)).toBe(0);
    });
  });

  describe('getChangeDirection', () => {
    test('classifies positive as up', () => {
      expect(getChangeDirection(5)).toBe('up');
      expect(getChangeDirection(0.001)).toBe('up');
    });

    test('classifies negative as down', () => {
      expect(getChangeDirection(-3)).toBe('down');
      expect(getChangeDirection(-0.1)).toBe('down');
    });

    test('classifies zero as flat', () => {
      expect(getChangeDirection(0)).toBe('flat');
    });

    test('returns unknown for non-finite values', () => {
      expect(getChangeDirection(NaN)).toBe('unknown');
      expect(getChangeDirection(Infinity)).toBe('unknown');
      expect(getChangeDirection(null)).toBe('unknown');
      expect(getChangeDirection(undefined)).toBe('unknown');
    });
  });
});
