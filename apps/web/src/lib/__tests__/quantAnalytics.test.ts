import { buildDerivativesCurveRows, classifyDerivativesCurve } from '../derivativesAnalytics'
import { buildVolumeProfile } from '../marketStructure'
import { buildOwnershipSummary } from '../ownershipAnalytics'
import { computePairStats, dailyReturns, makeRng, runDrawdownBootstrap, toDatedCloses } from '../quantLabMath'
import { buildQuantRegimeSummary, computeHurstFromPrices, scoreDrawdown, scoreFlow } from '../quantRegime'
import { runDcf, solveImpliedGrowth } from '../valuationLab'

describe('quant analytics helpers', () => {
  it('normalizes close rows and computes daily returns', () => {
    expect(toDatedCloses([
      { time: '2026-01-01', close: '10' },
      { time: '2026-01-02', close: null },
      { time: '', close: 11 },
      { time: '2026-01-03', close: 12 },
    ])).toEqual([
      { time: '2026-01-01', close: 10 },
      { time: '2026-01-03', close: 12 },
    ])
    expect(dailyReturns([100, 110, 99])).toEqual([0.10000000000000009, -0.09999999999999998])
  })

  it('keeps seeded bootstrap deterministic', () => {
    const returns = Array.from({ length: 80 }, (_, index) => (index % 5 === 0 ? -0.01 : 0.004))
    const first = runDrawdownBootstrap(returns, { paths: 20, horizonDays: 15, seed: 7 })
    const second = runDrawdownBootstrap(returns, { paths: 20, horizonDays: 15, seed: 7 })
    expect(first).toEqual(second)
    expect(first?.sampleDays).toBe(80)
    expect(first?.maxDrawdownPct.p95).toBeLessThanOrEqual(first?.maxDrawdownPct.p5 ?? 0)
  })

  it('produces stable pseudo-random values for a seed', () => {
    const rng = makeRng(123)
    expect([rng(), rng(), rng()].map((value) => Number(value.toFixed(6)))).toEqual([0.283737, 0.43513, 0.038651])
  })

  it('aligns pair series by date and reports rolling correlation', () => {
    const a = Array.from({ length: 8 }, (_, index) => ({ time: `2026-01-${String(index + 1).padStart(2, '0')}`, close: 100 + index * 2 }))
    const b = Array.from({ length: 8 }, (_, index) => ({ time: `2026-01-${String(index + 1).padStart(2, '0')}`, close: 50 + index }))
    const stats = computePairStats(a, b, 3)
    expect(stats.alignedDays).toBe(8)
    expect(stats.series).toHaveLength(8)
    expect(stats.currentCorrelation).not.toBeNull()
  })

  it('classifies quant regimes and bounded scores', () => {
    expect(computeHurstFromPrices(Array.from({ length: 130 }, () => 100))).toBeNull()
    const summary = buildQuantRegimeSummary({ hurst: 0.6, volatilityRegime: 'low', momentumScore: 3 })
    expect(summary.regimeLabel).toBe('Trending Low-Vol Bull')
    expect(scoreFlow(10, [-20, 0, 20])).toBe(75)
    expect(scoreDrawdown(-20, 30)).toBe(63)
  })
})

describe('market structure analytics', () => {
  it('builds volume profile with contiguous value area and sorted key levels', () => {
    const profile = buildVolumeProfile([
      { high: 10, low: 8, close: 9, volume: 100 },
      { high: 12, low: 10, close: 11, volume: 400 },
      { high: 14, low: 12, close: 13, volume: 200 },
      { high: 16, low: 14, close: 15, volume: 50 },
    ], 4, 0.7)
    expect(profile?.bins).toHaveLength(4)
    expect(profile?.poc).toBe(11)
    expect(profile?.totalVolume).toBe(750)
    expect(profile?.keyLevels[0].volume).toBe(400)
    expect(profile?.bins.some((bin) => bin.isPoc && bin.inValueArea)).toBe(true)
  })
})

describe('valuation analytics', () => {
  it('runs DCF and solves implied growth near the original assumption', () => {
    const assumptions = {
      baseFcf: 100,
      growthRate: 0.08,
      forecastYears: 5,
      discountRate: 0.12,
      terminalGrowth: 0.03,
      netDebt: 50,
      sharesOutstanding: 10,
    }
    const result = runDcf(assumptions)
    expect(result.valid).toBe(true)
    expect(result.years).toHaveLength(5)
    expect(result.intrinsicPerShare).toBeGreaterThan(100)
    const { growthRate: _growthRate, ...reverseAssumptions } = assumptions
    expect(solveImpliedGrowth(reverseAssumptions, result.intrinsicPerShare ?? 0)).toBeCloseTo(0.08, 3)
  })

  it('rejects invalid terminal growth assumptions', () => {
    const result = runDcf({ baseFcf: 100, growthRate: 0.05, forecastYears: 3, discountRate: 0.03, terminalGrowth: 0.04, sharesOutstanding: 1 })
    expect(result.valid).toBe(false)
    expect(result.warning).toMatch(/Terminal growth/)
    expect(result.terminalValue).toBe(0)
  })
})

describe('ownership analytics', () => {
  it('normalizes ratio ownership fields and scores positive flows', () => {
    const summary = buildOwnershipSummary([
      { symbol: 'FPT', shareholder_name: 'Fund A', shareholder_type: 'Institutional fund', ownership_pct: 0.3 },
      { symbol: 'FPT', shareholder_name: 'Foreign B', shareholder_type: 'Foreign investor', ownership_pct: 0.2 },
      { symbol: 'FPT', shareholder_name: 'Exec C', shareholder_type: 'Management insider', ownership_pct: 0.1 },
    ], [{ buy_volume: 1000, sell_volume: 250 }], { net_value: 500 } as never)
    expect(summary.top3Pct).toBe(60)
    expect(summary.foreignNetVolume).toBe(750)
    expect(summary.insiderNetValue).toBe(500)
    expect(summary.grade).toBe('A')
  })
})

describe('derivatives analytics', () => {
  it('sorts contracts, computes curve stats, and classifies term structure', () => {
    const history = Array.from({ length: 21 }, (_, index) => ({ time: `2026-01-${String(index + 1).padStart(2, '0')}`, close: 100 + index, volume: 1000 + index }))
    const rows = buildDerivativesCurveRows([
      { symbol: 'BACK', name: 'Back', expiry: '2026-03-01' },
      { symbol: 'FRONT', name: 'Front', expiry: '2026-02-01' },
    ], {
      FRONT: history,
      BACK: history.map((row) => ({ ...row, close: row.close + 5 })),
    })
    expect(rows.map((row) => row.symbol)).toEqual(['FRONT', 'BACK'])
    expect(rows[0].avgVolume20d).toBe(1011)
    expect(rows[1].spreadToFrontPct).toBeCloseTo(4.17, 2)
    expect(classifyDerivativesCurve(rows)).toBe('contango')
    expect(classifyDerivativesCurve([])).toBe('unknown')
  })
})
