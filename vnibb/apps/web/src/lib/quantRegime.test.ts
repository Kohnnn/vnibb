import {
  buildQuantRegimeLabel,
  buildQuantRegimeSummary,
  classifyMomentum,
  classifyVolatility,
  quantPeriodToStartDate,
  scoreDrawdown,
  scoreEmaRespect,
  scoreFlow,
  scoreSeasonality,
  scoreSortino,
} from './quantRegime'

describe('quantRegime helpers', () => {
  it('builds a readable regime label', () => {
    expect(
      buildQuantRegimeLabel({
        hurst: 0.62,
        volatilityRegime: 'low',
        momentumScore: 3,
        momentumLabel: 'Strong Uptrend',
      }),
    ).toBe('Trending Low-Vol Bull')
  })

  it('classifies volatility and momentum consistently', () => {
    expect(classifyVolatility('high').shortLabel).toBe('High-Vol')
    expect(classifyMomentum('Downtrend', -2).shortLabel).toBe('Bear')
  })

  it('scores drawdown, flow, seasonality, sortino, and EMA respect', () => {
    expect(scoreDrawdown(-8, 12)).toBeGreaterThan(scoreDrawdown(-35, 70))
    expect(scoreFlow(12, [2, 4, 10])).toBeGreaterThan(scoreFlow(-12, [-2, -4, -10]))
    expect(scoreSeasonality(68)).toBe(68)
    expect(scoreSortino(2.5)).toBeGreaterThan(scoreSortino(0))
    expect(
      scoreEmaRespect([
        { support_bounce_rate_pct: 78, support_strength: 'strong' },
        { support_bounce_rate_pct: 61, support_strength: 'moderate' },
      ]),
    ).toBeGreaterThan(70)
  })

  it('returns action-oriented summary details', () => {
    const summary = buildQuantRegimeSummary({
      hurst: 0.64,
      volatilityRegime: 'low',
      momentumScore: 2,
      momentumLabel: 'Uptrend',
    })

    expect(summary.regimeLabel).toBe('Trending Low-Vol Bull')
    expect(summary.action).toContain('Momentum')
  })

  it('derives a historical lookback date for quant periods', () => {
    const startDate = quantPeriodToStartDate('1Y')
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
