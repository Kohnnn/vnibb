'use client'

/**
 * Client-side descriptive market statistics for the Quant Market Lab widget.
 *
 * Turtle-hub-inspired "Market Lab": descriptive, not predictive. All computation
 * is local over EOD bars already fetched from `/equity/historical`. No new
 * backend endpoint and no strategy-code execution.
 */

export interface MarketLabBar {
  time: string
  close: number
  volume?: number | null
}

export interface MarketLabStats {
  symbol: string
  barCount: number
  startDate: string | null
  endDate: string | null
  // return stats (on daily log/simple returns)
  meanDailyReturnPct: number | null
  annualizedReturnPct: number | null
  annualizedVolPct: number | null
  sharpe: number | null
  sortino: number | null
  // distribution
  skew: number | null
  excessKurtosis: number | null
  bestDayPct: number | null
  worstDayPct: number | null
  positiveDayRatio: number | null
  // tail
  var95Pct: number | null
  cvar95Pct: number | null
  // drawdown
  maxDrawdownPct: number | null
  // seasonality: average simple return % by calendar month (index 0 = Jan)
  monthlyAvgReturnPct: Array<number | null>
  // market-structure diagnostics (descriptive; null when < 120 returns)
  structure: MarketStructureStats | null
}

export interface VarianceRatioPoint {
  q: number
  vr: number | null
  z: number | null
}

export interface RollingVolPoint {
  date: string
  volPct: number
}

export interface MarketStructureStats {
  /** Lo-MacKinlay variance ratio with heteroskedasticity-robust z for q = 2, 5, 10. */
  varianceRatio: VarianceRatioPoint[]
  /** Autocorrelation of squared returns at lags 1..N (volatility clustering proxy). */
  squaredReturnAcf: number[]
  /** Rolling 21D annualized volatility over time. */
  rollingVol: RollingVolPoint[]
  rollingVolCurrentPct: number | null
  rollingVolMedianPct: number | null
}

const TRADING_DAYS = 252
const STRUCTURE_MIN_RETURNS = 120
const ROLLING_VOL_WINDOW = 21

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0
  const m = avg ?? mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function annualizedReturn(dailyReturns: number[]): number | null {
  if (!dailyReturns.length) return null
  // Compound the daily simple returns, then annualize by trading days.
  const growth = dailyReturns.reduce((acc, r) => acc * (1 + r), 1)
  if (growth <= 0) return null
  const years = dailyReturns.length / TRADING_DAYS
  if (years <= 0) return null
  return (growth ** (1 / years) - 1) * 100
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

/**
 * Lo-MacKinlay variance ratio test on log returns.
 *
 * VR(q) = Var(q-period overlapping log returns) / (q * Var(1-period log returns)).
 * Returns the ratio plus the heteroskedasticity-robust z-statistic (Lo-MacKinlay 1988).
 * Requires >= STRUCTURE_MIN_RETURNS log returns; returns null otherwise.
 */
export function computeVarianceRatio(logReturns: number[], q: number): { vr: number; z: number } | null {
  const n = logReturns.length
  if (q < 2 || n < STRUCTURE_MIN_RETURNS || n < q + 1) return null

  const mu = mean(logReturns)
  // 1-period variance (unbiased, mean-adjusted).
  let var1 = 0
  for (const r of logReturns) var1 += (r - mu) ** 2
  var1 /= n - 1
  if (var1 <= 1e-18) return null

  // q-period overlapping sums; Lo-MacKinlay bias correction m = q*(n-q+1)*(1-q/n).
  const numObs = n - q + 1
  const m = q * numObs * (1 - q / n)
  if (m <= 0) return null
  let varQ = 0
  for (let i = 0; i <= n - q; i += 1) {
    let s = 0
    for (let j = 0; j < q; j += 1) s += logReturns[i + j] - mu
    varQ += s * s
  }
  varQ /= m

  const vr = varQ / var1
  // Heteroskedasticity-robust z (Lo-MacKinlay 1988, theorem 2):
  //   z*(q) = sqrt(N) * (VR - 1) / sqrt(theta),   N = number of 1-period returns
  //   theta = sum_{j=1}^{q-1} [2(q-j)/q]^2 * delta(j)
  //   delta(j) = N * sum_t d_t^2 d_{t-j}^2 / (sum_t d_t^2)^2,   d_t = r_t - mu
  // The N factor keeps delta (and theta) O(1) so sqrt(N)*(VR-1)/sqrt(theta) -> N(0,1).
  const d2 = logReturns.map((r) => (r - mu) ** 2)
  const sumD2 = d2.reduce((acc, v) => acc + v, 0)
  const denom = sumD2 * sumD2
  let theta = 0
  if (denom > 1e-30) {
    for (let j = 1; j < q; j += 1) {
      let deltaNum = 0
      for (let t = j; t < n; t += 1) deltaNum += d2[t] * d2[t - j]
      const delta = (deltaNum * n) / denom
      const weight = (2 * (q - j)) / q
      theta += weight * weight * delta
    }
  }
  if (theta <= 1e-30) return { vr, z: 0 }
  const z = (Math.sqrt(n) * (vr - 1)) / Math.sqrt(theta)
  return { vr, z }
}

/** Autocorrelation of squared (demeaned) returns at lags 1..maxLag. */
export function computeSquaredReturnAcf(returns: number[], maxLag: number): number[] {
  if (returns.length < STRUCTURE_MIN_RETURNS) return []
  const avg = mean(returns)
  const sq = returns.map((r) => (r - avg) ** 2)
  const sqMean = mean(sq)
  let denom = 0
  for (const v of sq) denom += (v - sqMean) ** 2
  if (denom <= 1e-30) return Array.from({ length: maxLag }, () => 0)
  const out: number[] = []
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let num = 0
    for (let t = lag; t < sq.length; t += 1) num += (sq[t] - sqMean) * (sq[t - lag] - sqMean)
    out.push(num / denom)
  }
  return out
}

function computeMarketStructure(
  simpleReturns: number[],
  datedReturns: Array<{ date: string; r: number }>,
): MarketStructureStats | null {
  if (simpleReturns.length < STRUCTURE_MIN_RETURNS) return null
  // Variance ratio works on log returns; derive from simple returns.
  const logReturns = simpleReturns.map((r) => Math.log(1 + r)).filter((v) => Number.isFinite(v))

  const varianceRatio: VarianceRatioPoint[] = [2, 5, 10].map((q) => {
    const res = computeVarianceRatio(logReturns, q)
    return { q, vr: res ? res.vr : null, z: res ? res.z : null }
  })

  const squaredReturnAcf = computeSquaredReturnAcf(simpleReturns, 10)

  // Rolling 21D annualized volatility.
  const rollingVol: RollingVolPoint[] = []
  for (let i = ROLLING_VOL_WINDOW - 1; i < datedReturns.length; i += 1) {
    const window = datedReturns.slice(i - ROLLING_VOL_WINDOW + 1, i + 1).map((p) => p.r)
    const sd = stdDev(window)
    rollingVol.push({ date: datedReturns[i].date, volPct: sd * Math.sqrt(TRADING_DAYS) * 100 })
  }
  const rollingVolCurrentPct = rollingVol.length ? rollingVol[rollingVol.length - 1].volPct : null
  let rollingVolMedianPct: number | null = null
  if (rollingVol.length) {
    const sortedVol = rollingVol.map((p) => p.volPct).sort((a, b) => a - b)
    rollingVolMedianPct = sortedVol[Math.floor(sortedVol.length / 2)]
  }

  return { varianceRatio, squaredReturnAcf, rollingVol, rollingVolCurrentPct, rollingVolMedianPct }
}

/**
 * Compute descriptive stats from a chronologically ascending list of bars.
 */
export function computeMarketLabStats(symbol: string, bars: MarketLabBar[]): MarketLabStats | null {
  const clean = bars
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({ time: bar.time, close: Number(bar.close) }))
  if (clean.length < 3) return null

  const simpleReturns: number[] = []
  const datedReturns: Array<{ date: string; r: number }> = []
  const monthlyBuckets: number[][] = Array.from({ length: 12 }, () => [])
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1].close
    const curr = clean[i].close
    if (prev <= 0) continue
    const r = curr / prev - 1
    simpleReturns.push(r)
    datedReturns.push({ date: clean[i].time, r })
    const month = new Date(clean[i].time).getMonth()
    if (month >= 0 && month <= 11) monthlyBuckets[month].push(r)
  }

  if (!simpleReturns.length) return null

  const avg = mean(simpleReturns)
  const sd = stdDev(simpleReturns, avg)
  const downside = simpleReturns.filter((r) => r < 0)
  const downsideDev = stdDev(downside.length ? downside : [0])

  // skew & excess kurtosis (sample moments)
  let skew: number | null = null
  let excessKurtosis: number | null = null
  if (sd > 0 && simpleReturns.length > 2) {
    const n = simpleReturns.length
    const m3 = simpleReturns.reduce((acc, r) => acc + (r - avg) ** 3, 0) / n
    const m4 = simpleReturns.reduce((acc, r) => acc + (r - avg) ** 4, 0) / n
    skew = m3 / sd ** 3
    excessKurtosis = m4 / sd ** 4 - 3
  }

  const sorted = [...simpleReturns].sort((a, b) => a - b)
  const var95 = percentile(sorted, 0.05)
  const tail = sorted.filter((r) => var95 !== null && r <= var95)
  const cvar95 = tail.length ? mean(tail) : var95

  // max drawdown on the close series
  let peak = clean[0].close
  let maxDd = 0
  for (const bar of clean) {
    if (bar.close > peak) peak = bar.close
    const dd = peak > 0 ? bar.close / peak - 1 : 0
    if (dd < maxDd) maxDd = dd
  }

  const annReturn = annualizedReturn(simpleReturns)
  const annVol = sd * Math.sqrt(TRADING_DAYS) * 100
  const sharpe = sd > 0 ? (avg * TRADING_DAYS) / (sd * Math.sqrt(TRADING_DAYS)) : null
  const sortino = downsideDev > 0 ? (avg * TRADING_DAYS) / (downsideDev * Math.sqrt(TRADING_DAYS)) : null

  return {
    symbol,
    barCount: clean.length,
    startDate: clean[0].time ?? null,
    endDate: clean[clean.length - 1].time ?? null,
    meanDailyReturnPct: avg * 100,
    annualizedReturnPct: annReturn,
    annualizedVolPct: annVol,
    sharpe,
    sortino,
    skew,
    excessKurtosis,
    bestDayPct: sorted[sorted.length - 1] * 100,
    worstDayPct: sorted[0] * 100,
    positiveDayRatio: simpleReturns.filter((r) => r > 0).length / simpleReturns.length,
    var95Pct: var95 !== null ? var95 * 100 : null,
    cvar95Pct: cvar95 !== null && cvar95 !== undefined ? cvar95 * 100 : null,
    maxDrawdownPct: maxDd * 100,
    monthlyAvgReturnPct: monthlyBuckets.map((bucket) => (bucket.length ? mean(bucket) * 100 : null)),
    structure: computeMarketStructure(simpleReturns, datedReturns),
  }
}

export function marketLabStatsToRows(stats: MarketLabStats): Array<Record<string, string | number>> {
  const fmt = (value: number | null, digits = 2): string => (value === null ? '—' : value.toFixed(digits))
  return [
    { metric: 'Bars', value: stats.barCount },
    { metric: 'Start', value: stats.startDate ?? '—' },
    { metric: 'End', value: stats.endDate ?? '—' },
    { metric: 'Annualized return %', value: fmt(stats.annualizedReturnPct) },
    { metric: 'Annualized volatility %', value: fmt(stats.annualizedVolPct) },
    { metric: 'Sharpe (rf=0)', value: fmt(stats.sharpe) },
    { metric: 'Sortino (rf=0)', value: fmt(stats.sortino) },
    { metric: 'Max drawdown %', value: fmt(stats.maxDrawdownPct) },
    { metric: 'VaR 95% (daily) %', value: fmt(stats.var95Pct) },
    { metric: 'CVaR 95% (daily) %', value: fmt(stats.cvar95Pct) },
    { metric: 'Skew', value: fmt(stats.skew) },
    { metric: 'Excess kurtosis', value: fmt(stats.excessKurtosis) },
    { metric: 'Best day %', value: fmt(stats.bestDayPct) },
    { metric: 'Worst day %', value: fmt(stats.worstDayPct) },
    { metric: 'Positive day ratio', value: fmt(stats.positiveDayRatio, 3) },
  ]
}

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
