import { formatPercent } from './units';

// Mirrors the chart helpers' contract: formatPercent owns missing, non-meaningful
// and the sign, so a clamped or tiny delta is never rendered as `+n/m`/`+0.0%`.
const formatDelta = (changePct: number | null | undefined) =>
  formatPercent(changePct, { decimals: 1, input: 'percent', clamp: 'yoy_change', signed: true });

describe('chart delta formatting', () => {
  it('renders a large but representable change with its sign', () => {
    expect(formatDelta(850)).toBe('+850.0%');
  });

  it('marks a change that is still out of range after clamping as non-meaningful', () => {
    expect(formatDelta(5000)).toBe('n/m');
  });

  it('does not sign a change that rounds to zero', () => {
    expect(formatDelta(0.02)).toBe('0.0%');
    expect(formatDelta(0)).toBe('0.0%');
  });

  it('signs real gains and losses', () => {
    expect(formatDelta(12.5)).toBe('+12.5%');
    expect(formatDelta(-12.5)).toBe('-12.5%');
  });

  it('separates missing from non-meaningful', () => {
    expect(formatDelta(null)).toBe('n/a');
    expect(formatDelta(Number.NaN)).toBe('n/a');
  });
});
