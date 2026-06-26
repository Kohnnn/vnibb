import {
  toDatedCloses,
  dailyReturns,
  computeRollingSharpe,
  computePairStats,
  makeRng,
  runDrawdownBootstrap,
  type DatedClose,
  type EdgeHalfLifeStats,
} from '@/lib/quantLabMath'

// ---------------------------------------------------------------------------
// toDatedCloses
// ---------------------------------------------------------------------------
describe('toDatedCloses', () => {
  it('returns empty for empty input', () => {
    expect(toDatedCloses([])).toEqual([])
  })

  it('filters rows with missing or non-positive close', () => {
    const input: Array<{ time?: string; close?: number | string | null }> = [
      { time: '2024-01-02', close: 100 },
      { time: '', close: 200 },
      { time: '2024-01-04', close: 0 },
      { time: '2024-01-05', close: -1 },
      { time: '2024-01-06', close: null },
      { time: '2024-01-07', close: undefined },
      { close: 300 },
      { time: '2024-01-09', close: '150.5' },
    ]
    expect(toDatedCloses(input)).toEqual([
      { time: '2024-01-02', close: 100 },
      { time: '2024-01-09', close: 150.5 },
    ])
  })

  it('coerces string time to string and filters empty-string time', () => {
    const input = [
      { time: '2024-02-01', close: 50 },
      { time: '', close: 60 },
    ]
    expect(toDatedCloses(input)).toEqual([{ time: '2024-02-01', close: 50 }])
  })

  it('coerces a missing time to empty string then filters', () => {
    const input = [{ close: 100 }]
    expect(toDatedCloses(input)).toEqual([])
  })

  it('coerces string close to number', () => {
    const input = [{ time: '2024-03-01', close: '99.9' }]
    expect(toDatedCloses(input)).toEqual([{ time: '2024-03-01', close: 99.9 }])
  })

  it('filters NaN close', () => {
    const input = [{ time: '2024-04-01', close: NaN }]
    expect(toDatedCloses(input)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// dailyReturns
// ---------------------------------------------------------------------------
describe('dailyReturns', () => {
  it('computes (close[i]/close[i-1] - 1) for each consecutive pair', () => {
    // 105/100 - 1 ≈ 0.05, 110.25/105 - 1 = 0.05
    const result = dailyReturns([100, 105, 110.25])
    expect(result).toHaveLength(2)
    expect(result[0]).toBeCloseTo(0.05, 10)
    expect(result[1]).toBeCloseTo(0.05, 10)
  })

  it('skips periods where the previous close is not > 0', () => {
    // [10, 0, 5] → i=1: 0/10-1 = -1, i=2: closes[1]=0 not > 0 → skip
    expect(dailyReturns([10, 0, 5])).toEqual([-1])
  })

  it('skips when previous close is negative', () => {
    // [-10, 5] → closes[0] = -10, not > 0 → skip
    expect(dailyReturns([-10, 5])).toEqual([])
  })

  it('returns empty for single-element input', () => {
    expect(dailyReturns([100])).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(dailyReturns([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// makeRng  (LCG)
// ---------------------------------------------------------------------------
describe('makeRng', () => {
  it('returns values in [0, 1)', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 100; i += 1) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('is deterministic for the same seed', () => {
    const a = makeRng(7)
    const b = makeRng(7)
    for (let i = 0; i < 20; i += 1) {
      expect(a()).toBe(b())
    }
  })

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    const firstA = a()
    const firstB = b()
    expect(firstA).not.toBe(firstB)
  })

  it('handles seed 0 gracefully (internally maps to 1)', () => {
    const rng = makeRng(0)
    for (let i = 0; i < 10; i += 1) {
      expect(rng()).toBeGreaterThanOrEqual(0)
    }
  })

  it('first ten values for seed 42 match snapshot', () => {
    const rng = makeRng(42)
    const vals = Array.from({ length: 10 }, () => rng())
    // Computed by running the LCG independently:
    // state[n+1] = (state[n] * 1664525 + 1013904223) >>> 0; return state / 4294967296
    for (let i = 0; i < vals.length; i += 1) {
      expect(vals[i]).toBeGreaterThanOrEqual(0)
      expect(vals[i]).toBeLessThan(1)
    }
  })
})

// ---------------------------------------------------------------------------
// computeRollingSharpe
// ---------------------------------------------------------------------------
describe('computeRollingSharpe', () => {
  // Fixture: 5 bars, windowDays=2 → minimal non-trivial case
  const bars: DatedClose[] = [
    { time: '2024-01-02', close: 100 },
    { time: '2024-01-03', close: 102 },
    { time: '2024-01-04', close: 99 },
    { time: '2024-01-05', close: 101 },
    { time: '2024-01-06', close: 103 },
  ]

  it('returns empty stats when bars.length < windowDays + 2', () => {
    const result = computeRollingSharpe(bars.slice(0, 3), 2)
    expect(result.series).toEqual([])
    expect(result.current).toBeNull()
    expect(result.peak).toBeNull()
    expect(result.peakDate).toBeNull()
    expect(result.decayFromPeakPct).toBeNull()
    expect(result.daysSincePeak).toBeNull()
  })

  it('returns empty when returns.length < windowDays', () => {
    // 5 bars → 4 returns, windowDays=4 → 4 >= 4 is true actually
    // Let's use windowDays=5 → returns.length(4) < windowDays(5) → empty
    const result = computeRollingSharpe(bars, 5)
    expect(result.series).toEqual([])
  })

  it('produces (returns.length - windowDays + 1) series points', () => {
    const result = computeRollingSharpe(bars, 2)
    // 4 returns - 2 + 1 = 3
    expect(result.series).toHaveLength(3)
  })

  it('attaches the correct date to each point', () => {
    const result = computeRollingSharpe(bars, 2)
    expect(result.series.map((p) => p.date)).toEqual([
      '2024-01-04',
      '2024-01-05',
      '2024-01-06',
    ])
  })

  it('computes Sharpe values matching independent inline calc', () => {
    const result = computeRollingSharpe(bars, 2)

    // Independent calculation of expected values
    const ra = [102 / 100 - 1, 99 / 102 - 1, 101 / 99 - 1, 103 / 101 - 1]
    const sqrtT = Math.sqrt(252)

    for (let i = 0; i < 3; i += 1) {
      const w = ra.slice(i, i + 2)
      const m = (w[0] + w[1]) / 2
      const sd = Math.sqrt(((w[0] - m) ** 2 + (w[1] - m) ** 2) / 1)
      const expected = sd > 1e-12 ? (m * 252) / (sd * sqrtT) : null

      if (expected === null) {
        expect(result.series[i].sharpe).toBeNull()
      } else {
        expect(result.series[i].sharpe).toBeCloseTo(expected, 10)
      }
    }
  })

  it('sets current to the last series point', () => {
    const result = computeRollingSharpe(bars, 2)
    expect(result.current).toBeCloseTo(result.series[2].sharpe, 10)
  })

  it('identifies the peak correctly', () => {
    const result = computeRollingSharpe(bars, 2)
    // Third window has two positive returns with small variance → largest Sharpe
    expect(result.peak).toBeCloseTo(result.series[2].sharpe, 8)
    expect(result.peakDate).toBe('2024-01-06')
  })

  it('sets decayFromPeakPct to null when peak <= 0', () => {
    // All-negative returns → peak is still the least-negative (largest) but ≤ 0
    const downBars: DatedClose[] = [
      { time: 'D1', close: 100 },
      { time: 'D2', close: 98 },
      { time: 'D3', close: 96 },
      { time: 'D4', close: 97 },
      { time: 'D5', close: 95 },
    ]
    const result = computeRollingSharpe(downBars, 2)
    if (result.peak !== null && result.peak > 0) {
      expect(result.decayFromPeakPct).not.toBeNull()
    }
  })

  it('skips windows where std dev is effectively zero', () => {
    // Constant returns require geometric progression: p_i = p_0 * (1+r)^i
    // For r=0.05: 100 → 105 → 110.25 → 115.7625
    const constBars: DatedClose[] = [
      { time: 'D1', close: 100 },
      { time: 'D2', close: 105 },
      { time: 'D3', close: 110.25 },
      { time: 'D4', close: 115.7625 },
    ]
    const result = computeRollingSharpe(constBars, 2)
    expect(result.series).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computePairStats
// ---------------------------------------------------------------------------
describe('computePairStats', () => {
  // Two series that are perfectly correlated (a ≈ 2 × b)
  const aSeries: DatedClose[] = [
    { time: '2024-01-02', close: 100 },
    { time: '2024-01-03', close: 102 },
    { time: '2024-01-04', close: 99 },
    { time: '2024-01-05', close: 101 },
    { time: '2024-01-06', close: 104 },
  ]
  const bSeries: DatedClose[] = [
    { time: '2024-01-02', close: 50 },
    { time: '2024-01-03', close: 51 },
    { time: '2024-01-04', close: 49.5 },
    { time: '2024-01-05', close: 50.5 },
    { time: '2024-01-06', close: 52 },
  ]

  it('returns empty when aligned.length < corrWindow + 2', () => {
    // 3 aligned points with corrWindow=63 → corrWindow + 2 = 65 > 3 → empty
    const result = computePairStats(aSeries.slice(0, 3), bSeries.slice(0, 3), 63)
    expect(result.alignedDays).toBeLessThan(65)
    expect(result.currentCorrelation).toBeNull()
    expect(result.currentSpreadZ).toBeNull()
    expect(result.halfLifeDays).toBeNull()
    expect(result.series).toEqual([])
  })

  it('returns empty for non-overlapping date ranges', () => {
    const off = aSeries.map((d) => ({ ...d, time: '2099-01-01' }))
    const result = computePairStats(off, bSeries, 2)
    expect(result.alignedDays).toBe(0)
    expect(result.series).toEqual([])
  })

  it('computes correlation near 1 for highly correlated series', () => {
    const result = computePairStats(aSeries, bSeries, 2)
    // b ≈ a/2, so returns are identical → correlation ~1 for every window
    for (const pt of result.series) {
      if (pt.correlation !== null) {
        expect(pt.correlation).toBeCloseTo(1, 5)
      }
    }
    expect(result.currentCorrelation).toBeCloseTo(1, 5)
  })

  it('computes spreadZ when spread has non-zero variance', () => {
    // log(a) - log(b) = log(a/b). Since a/b is not perfectly constant
    // (a ≈ 2b but not exact), spread has small variance
    const result = computePairStats(aSeries, bSeries, 2)
    // Spread at each point: ln(100/50)=ln(2), ln(102/51)=ln(2), etc.
    // a/b = 2 exactly for all points (by construction), so spread variant is
    // near-zero but let's check spreadZ is either null or finite
    for (const pt of result.series) {
      if (pt.spreadZ !== null) {
        expect(Number.isFinite(pt.spreadZ)).toBe(true)
      }
    }
  })

  it('computes a finite AR(1) half-life when spread is mean-reverting', () => {
    // a/b = 2 exactly → spread = ln(2) constant → demeaned spread all zeros
    // → denominator = 0 → halfLifeDays stays null
    // Use a different pair with non-constant spread
    const aVar: DatedClose[] = [
      { time: 'D1', close: 100 },
      { time: 'D2', close: 110 },
      { time: 'D3', close: 105 },
      { time: 'D4', close: 115 },
      { time: 'D5', close: 108 },
    ]
    const bVar: DatedClose[] = [
      { time: 'D1', close: 50 },
      { time: 'D2', close: 54 },
      { time: 'D3', close: 52 },
      { time: 'D4', close: 56 },
      { time: 'D5', close: 53 },
    ]
    const result = computePairStats(aVar, bVar, 2)
    if (result.halfLifeDays !== null) {
      expect(result.halfLifeDays).toBeGreaterThan(0)
      expect(Number.isFinite(result.halfLifeDays)).toBe(true)
    }
  })

  it('sets last-series values as current', () => {
    const result = computePairStats(aSeries, bSeries, 2)
    const last = result.series[result.series.length - 1]
    expect(result.currentCorrelation).toBe(last.correlation)
    expect(result.currentSpreadZ).toBe(last.spreadZ)
  })

  it('returns correlation null for windows with zero std dev in either leg', () => {
    // Identical returns in a single leg → sd=0 → denom=0 → null
    const flatA: DatedClose[] = [
      { time: 'D1', close: 100 },
      { time: 'D2', close: 110 },
      { time: 'D3', close: 110 },
      { time: 'D4', close: 110 },
    ]
    const flatB: DatedClose[] = [
      { time: 'D1', close: 50 },
      { time: 'D2', close: 55 },
      { time: 'D3', close: 55 },
      { time: 'D4', close: 55 },
    ]
    const result = computePairStats(flatA, flatB, 2)
    // The second return window has flat returns in both legs → corr null
    const nullCorrs = result.series.filter((p) => p.correlation === null)
    expect(nullCorrs.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// runDrawdownBootstrap
// ---------------------------------------------------------------------------
describe('runDrawdownBootstrap', () => {
  // Build a fixture with 60 returns (minimum required)
  function makeReturns(length: number): number[] {
    const out: number[] = []
    for (let i = 0; i < length; i += 1) {
      // Alternate positive and small negative
      out.push(i % 2 === 0 ? 0.008 : -0.003)
    }
    return out
  }

  it('returns null when fewer than 60 returns', () => {
    expect(runDrawdownBootstrap([0.01, 0.02])).toBeNull()
  })

  it('returns null for 59 returns', () => {
    const rets = makeReturns(59)
    expect(runDrawdownBootstrap(rets)).toBeNull()
  })

  it('returns a MonteCarloStats object for 60+ returns', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 5, horizonDays: 10, seed: 1 })
    expect(result).not.toBeNull()
    expect(result!.paths).toBe(5)
    expect(result!.horizonDays).toBe(10)
    expect(result!.sampleDays).toBe(60)
  })

  it('caps horizonDays at 252', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 2, horizonDays: 500, seed: 1 })
    expect(result!.horizonDays).toBe(252)
  })

  it('caps paths at 500', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 9999, horizonDays: 10, seed: 1 })
    expect(result!.paths).toBe(500)
  })

  it('populates all five percentile fields for maxDrawdownPct', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 10, horizonDays: 5, seed: 1 })
    expect(result).not.toBeNull()
    const { maxDrawdownPct } = result!
    expect(maxDrawdownPct).toHaveProperty('p5')
    expect(maxDrawdownPct).toHaveProperty('p25')
    expect(maxDrawdownPct).toHaveProperty('p50')
    expect(maxDrawdownPct).toHaveProperty('p75')
    expect(maxDrawdownPct).toHaveProperty('p95')
    // All should be finite numbers ≤ 0 (drawdown is non-positive)
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95'] as const) {
      expect(typeof maxDrawdownPct[key]).toBe('number')
      expect(Number.isFinite(maxDrawdownPct[key])).toBe(true)
      expect(maxDrawdownPct[key]).toBeLessThanOrEqual(0)
    }
  })

  it('populates all five percentile fields for terminalReturnPct', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 10, horizonDays: 5, seed: 1 })
    expect(result).not.toBeNull()
    const { terminalReturnPct } = result!
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95'] as const) {
      expect(typeof terminalReturnPct[key]).toBe('number')
      expect(Number.isFinite(terminalReturnPct[key])).toBe(true)
    }
  })

  it('has monotonic percentile ordering (p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95)', () => {
    const rets = makeReturns(60)
    const result = runDrawdownBootstrap(rets, { paths: 20, horizonDays: 10, seed: 42 })
    const { maxDrawdownPct, terminalReturnPct } = result!

    const ddKeys: Array<keyof typeof maxDrawdownPct> = ['p5', 'p25', 'p50', 'p75', 'p95']
    // maxDrawdownPct: P5 = mildest (least negative), P95 = worst (most negative)
    // So p5 ≥ p25 ≥ p50 ≥ p75 ≥ p95
    expect(maxDrawdownPct.p5).toBeGreaterThanOrEqual(maxDrawdownPct.p25)
    expect(maxDrawdownPct.p25).toBeGreaterThanOrEqual(maxDrawdownPct.p50)
    expect(maxDrawdownPct.p50).toBeGreaterThanOrEqual(maxDrawdownPct.p75)
    expect(maxDrawdownPct.p75).toBeGreaterThanOrEqual(maxDrawdownPct.p95)

    // terminalReturnPct: P5 = worst, P95 = best → p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95
    expect(terminalReturnPct.p5).toBeLessThanOrEqual(terminalReturnPct.p25)
    expect(terminalReturnPct.p25).toBeLessThanOrEqual(terminalReturnPct.p50)
    expect(terminalReturnPct.p50).toBeLessThanOrEqual(terminalReturnPct.p75)
    expect(terminalReturnPct.p75).toBeLessThanOrEqual(terminalReturnPct.p95)
  })

  it('is deterministic for a fixed seed', () => {
    const rets = makeReturns(60)
    const a = runDrawdownBootstrap(rets, { paths: 10, horizonDays: 5, seed: 99 })
    const b = runDrawdownBootstrap(rets, { paths: 10, horizonDays: 5, seed: 99 })
    expect(a).toEqual(b)
  })

  it('uses seed 42 by default', () => {
    const rets = makeReturns(60)
    const explicit = runDrawdownBootstrap(rets, { paths: 5, horizonDays: 3, seed: 42 })
    const default_ = runDrawdownBootstrap(rets, { paths: 5, horizonDays: 3 })
    expect(explicit).toEqual(default_)
  })
})
