import {
  computeVarianceRatio,
  computeSquaredReturnAcf,
  computeMarketLabStats,
  type MarketLabBar,
} from '@/lib/marketLabStats'

// Deterministic LCG so fixtures are reproducible without external deps.
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function gaussian(rng: () => number): number {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

describe('computeVarianceRatio', () => {
  it('returns null below the minimum sample size', () => {
    const short = Array.from({ length: 50 }, () => 0.001)
    expect(computeVarianceRatio(short, 2)).toBeNull()
  })

  it('returns null for q < 2', () => {
    const series = Array.from({ length: 200 }, () => 0.001)
    expect(computeVarianceRatio(series, 1)).toBeNull()
  })

  it('detects trending series with VR > 1 (positive serial correlation)', () => {
    // Strongly positively autocorrelated returns: r_t = 0.6 r_{t-1} + e.
    const rng = makeRng(7)
    const r: number[] = [0]
    for (let i = 1; i < 400; i += 1) r.push(0.6 * r[i - 1] + 0.01 * gaussian(rng))
    const res = computeVarianceRatio(r, 5)
    expect(res).not.toBeNull()
    expect(res!.vr).toBeGreaterThan(1)
    expect(res!.z).toBeGreaterThan(1.96)
  })

  it('detects mean-reverting series with VR < 1 (negative serial correlation)', () => {
    // Alternating/mean-reverting: r_t = -0.6 r_{t-1} + e.
    const rng = makeRng(11)
    const r: number[] = [0]
    for (let i = 1; i < 400; i += 1) r.push(-0.6 * r[i - 1] + 0.01 * gaussian(rng))
    const res = computeVarianceRatio(r, 2)
    expect(res).not.toBeNull()
    expect(res!.vr).toBeLessThan(1)
    expect(res!.z).toBeLessThan(-1.96)
  })

  it('keeps a random walk near VR = 1 with a well-behaved z', () => {
    const rng = makeRng(3)
    const r = Array.from({ length: 600 }, () => 0.01 * gaussian(rng))
    const res = computeVarianceRatio(r, 5)
    expect(res).not.toBeNull()
    expect(Math.abs(res!.vr - 1)).toBeLessThan(0.25)
    // z ~ N(0,1) under a random walk; |z| < 3 is a robust, non-flaky bound.
    expect(Math.abs(res!.z)).toBeLessThan(3)
  })
})

describe('computeSquaredReturnAcf', () => {
  it('returns empty below the minimum sample size', () => {
    expect(computeSquaredReturnAcf([0.01, -0.01, 0.02], 10)).toEqual([])
  })

  it('is near zero at all lags for iid noise', () => {
    const rng = makeRng(5)
    const r = Array.from({ length: 1000 }, () => 0.01 * gaussian(rng))
    const acf = computeSquaredReturnAcf(r, 10)
    expect(acf).toHaveLength(10)
    for (const v of acf) expect(Math.abs(v)).toBeLessThan(0.15)
  })

  it('is positive at short lags for a volatility-clustering (GARCH-like) series', () => {
    // sigma_t^2 = 0.00002 + 0.85 sigma_{t-1}^2 + 0.1 e_{t-1}^2 style clustering.
    const rng = makeRng(9)
    let sig2 = 0.0004
    let prevShock = 0
    const r: number[] = []
    for (let i = 0; i < 1500; i += 1) {
      sig2 = 0.00002 + 0.85 * sig2 + 0.1 * prevShock * prevShock
      const shock = Math.sqrt(sig2) * gaussian(rng)
      r.push(shock)
      prevShock = shock
    }
    const acf = computeSquaredReturnAcf(r, 10)
    expect(acf[0]).toBeGreaterThan(0.05)
    const shortLagAvg = (acf[0] + acf[1] + acf[2] + acf[3] + acf[4]) / 5
    expect(shortLagAvg).toBeGreaterThan(0)
  })
})

describe('computeMarketLabStats structure block', () => {
  function buildBars(returns: number[]): MarketLabBar[] {
    const bars: MarketLabBar[] = []
    let price = 100
    const start = new Date(Date.UTC(2020, 0, 1))
    bars.push({ time: start.toISOString().slice(0, 10), close: price })
    for (let i = 0; i < returns.length; i += 1) {
      price *= 1 + returns[i]
      const d = new Date(start.getTime())
      d.setUTCDate(d.getUTCDate() + i + 1)
      bars.push({ time: d.toISOString().slice(0, 10), close: price })
    }
    return bars
  }

  it('is null when there are fewer than 120 returns', () => {
    const rng = makeRng(1)
    const bars = buildBars(Array.from({ length: 80 }, () => 0.005 * gaussian(rng)))
    const stats = computeMarketLabStats('TEST', bars)
    expect(stats).not.toBeNull()
    expect(stats!.structure).toBeNull()
  })

  it('populates VR, ACF, and rolling vol for a long series', () => {
    const rng = makeRng(2)
    const bars = buildBars(Array.from({ length: 400 }, () => 0.01 * gaussian(rng)))
    const stats = computeMarketLabStats('TEST', bars)
    expect(stats!.structure).not.toBeNull()
    const s = stats!.structure!
    expect(s.varianceRatio.map((p) => p.q)).toEqual([2, 5, 10])
    expect(s.squaredReturnAcf).toHaveLength(10)
    expect(s.rollingVol.length).toBeGreaterThan(0)
    expect(s.rollingVolCurrentPct).not.toBeNull()
    expect(s.rollingVolMedianPct).not.toBeNull()
  })
})
