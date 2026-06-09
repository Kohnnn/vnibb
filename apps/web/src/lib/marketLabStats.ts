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
}

const TRADING_DAYS = 252

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
 * Compute descriptive stats from a chronologically ascending list of bars.
 */
export function computeMarketLabStats(symbol: string, bars: MarketLabBar[]): MarketLabStats | null {
  const clean = bars
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({ time: bar.time, close: Number(bar.close) }))
  if (clean.length < 3) return null

  const simpleReturns: number[] = []
  const monthlyBuckets: number[][] = Array.from({ length: 12 }, () => [])
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1].close
    const curr = clean[i].close
    if (prev <= 0) continue
    const r = curr / prev - 1
    simpleReturns.push(r)
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
