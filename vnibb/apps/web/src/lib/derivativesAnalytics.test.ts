import { buildDerivativesCurveRows, classifyDerivativesCurve } from '@/lib/derivativesAnalytics'

describe('derivativesAnalytics', () => {
  test('buildDerivativesCurveRows computes front spread and returns', () => {
    const rows = buildDerivativesCurveRows(
      [
        { symbol: 'VN30F1M', name: 'Front', expiry: '2099-05-20' },
        { symbol: 'VN30F2M', name: 'Next', expiry: '2099-06-20' },
      ],
      {
        VN30F1M: [
          { time: '2026-01-01', close: 1000, volume: 100000 },
          { time: '2026-01-31', close: 1010, volume: 120000 },
        ],
        VN30F2M: [
          { time: '2026-01-01', close: 1012, volume: 80000 },
          { time: '2026-01-31', close: 1030, volume: 90000 },
        ],
      }
    )

    expect(rows[1].spreadToFrontPct).toBeCloseTo(1.98, 1)
  })

  test('classifyDerivativesCurve detects contango', () => {
    const state = classifyDerivativesCurve([
      { symbol: 'A', expiry: '2099-05-20', daysToExpiry: 10, latestClose: 1000, avgVolume20d: 0, return20dPct: 0, realizedVol20dPct: 0, spreadToFrontPct: 0 },
      { symbol: 'B', expiry: '2099-06-20', daysToExpiry: 40, latestClose: 1025, avgVolume20d: 0, return20dPct: 0, realizedVol20dPct: 0, spreadToFrontPct: 2.5 },
    ])

    expect(state).toBe('contango')
  })
})
