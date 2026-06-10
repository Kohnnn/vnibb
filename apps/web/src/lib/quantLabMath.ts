'use client'

/**
 * Client-side math for the quant lab widgets (Edge Half-Life, Pair Lab,
 * Monte Carlo Lab). All functions are descriptive statistics over daily
 * adjusted closes — no signals, no predictions.
 */

const TRADING_DAYS = 252

export interface DatedClose {
  time: string
  close: number
}

export function toDatedCloses(rows: Array<{ time?: string; close?: number | string | null }>): DatedClose[] {
  return rows
    .map((row) => ({ time: String(row.time || ''), close: Number(row.close) }))
    .filter((row) => row.time && Number.isFinite(row.close) && row.close > 0)
}

export function dailyReturns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) out.push(closes[i] / closes[i - 1] - 1)
  }
  return out
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0
  const m = avg ?? mean(values)
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1))
}

// ---------------------------------------------------------------------------
// Edge Half-Life: rolling annualized Sharpe
// ---------------------------------------------------------------------------

export interface RollingSharpePoint {
  date: string
  sharpe: number
}

export interface EdgeHalfLifeStats {
  series: RollingSharpePoint[]
  current: number | null
  peak: number | null
  peakDate: string | null
  decayFromPeakPct: number | null
  daysSincePeak: number | null
}

export function computeRollingSharpe(bars: DatedClose[], windowDays: number): EdgeHalfLifeStats {
  const empty: EdgeHalfLifeStats = {
    series: [], current: null, peak: null, peakDate: null, decayFromPeakPct: null, daysSincePeak: null,
  }
  if (bars.length < windowDays + 2) return empty

  const returns: Array<{ date: string; r: number }> = []
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i - 1].close > 0) returns.push({ date: bars[i].time, r: bars[i].close / bars[i - 1].close - 1 })
  }
  if (returns.length < windowDays) return empty

  const series: RollingSharpePoint[] = []
  for (let i = windowDays - 1; i < returns.length; i += 1) {
    const window = returns.slice(i - windowDays + 1, i + 1).map((p) => p.r)
    const m = mean(window)
    const sd = stdDev(window, m)
    if (sd <= 1e-12) continue
    series.push({ date: returns[i].date, sharpe: (m * TRADING_DAYS) / (sd * Math.sqrt(TRADING_DAYS)) })
  }
  if (!series.length) return empty

  const current = series[series.length - 1].sharpe
  let peak = series[0].sharpe
  let peakIdx = 0
  for (let i = 1; i < series.length; i += 1) {
    if (series[i].sharpe > peak) {
      peak = series[i].sharpe
      peakIdx = i
    }
  }
  const decayFromPeakPct = peak > 0 ? ((peak - current) / peak) * 100 : null
  return {
    series,
    current,
    peak,
    peakDate: series[peakIdx].date,
    decayFromPeakPct,
    daysSincePeak: series.length - 1 - peakIdx,
  }
}

// ---------------------------------------------------------------------------
// Pair Lab: rolling correlation, log spread z-score, AR(1) half-life
// ---------------------------------------------------------------------------

export interface PairPoint {
  date: string
  correlation: number | null
  spreadZ: number | null
}

export interface PairStats {
  alignedDays: number
  series: PairPoint[]
  currentCorrelation: number | null
  currentSpreadZ: number | null
  halfLifeDays: number | null
}

/** Inner-join two close series on date, then compute pair diagnostics. */
export function computePairStats(a: DatedClose[], b: DatedClose[], corrWindow = 63): PairStats {
  const empty: PairStats = { alignedDays: 0, series: [], currentCorrelation: null, currentSpreadZ: null, halfLifeDays: null }
  const byDateB = new Map(b.map((row) => [row.time.slice(0, 10), row.close]))
  const aligned: Array<{ date: string; ca: number; cb: number }> = []
  for (const row of a) {
    const key = row.time.slice(0, 10)
    const cb = byDateB.get(key)
    if (cb !== undefined) aligned.push({ date: key, ca: row.close, cb })
  }
  if (aligned.length < corrWindow + 2) return empty

  // Log-price spread (1:1, descriptive; no hedge-ratio estimation in v1).
  const spread = aligned.map((row) => Math.log(row.ca) - Math.log(row.cb))
  const spreadMean = mean(spread)
  const spreadStd = stdDev(spread, spreadMean)

  const ra: number[] = []
  const rb: number[] = []
  for (let i = 1; i < aligned.length; i += 1) {
    ra.push(aligned[i].ca / aligned[i - 1].ca - 1)
    rb.push(aligned[i].cb / aligned[i - 1].cb - 1)
  }

  const series: PairPoint[] = []
  for (let i = 0; i < aligned.length; i += 1) {
    let correlation: number | null = null
    const rIdx = i - 1
    if (rIdx >= corrWindow - 1) {
      const wa = ra.slice(rIdx - corrWindow + 1, rIdx + 1)
      const wb = rb.slice(rIdx - corrWindow + 1, rIdx + 1)
      const ma = mean(wa)
      const mb = mean(wb)
      let cov = 0
      for (let j = 0; j < wa.length; j += 1) cov += (wa[j] - ma) * (wb[j] - mb)
      cov /= wa.length - 1
      const denom = stdDev(wa, ma) * stdDev(wb, mb)
      correlation = denom > 1e-12 ? cov / denom : null
    }
    series.push({
      date: aligned[i].date,
      correlation,
      spreadZ: spreadStd > 1e-12 ? (spread[i] - spreadMean) / spreadStd : null,
    })
  }

  // AR(1) half-life of the demeaned spread: x_t = phi * x_{t-1} + e.
  let halfLifeDays: number | null = null
  const x = spread.map((s) => s - spreadMean)
  let num = 0
  let den = 0
  for (let i = 1; i < x.length; i += 1) {
    num += x[i] * x[i - 1]
    den += x[i - 1] * x[i - 1]
  }
  if (den > 1e-12) {
    const phi = num / den
    if (phi > 0 && phi < 1) halfLifeDays = Math.log(0.5) / Math.log(phi)
  }

  const last = series[series.length - 1]
  return {
    alignedDays: aligned.length,
    series,
    currentCorrelation: last?.correlation ?? null,
    currentSpreadZ: last?.spreadZ ?? null,
    halfLifeDays: halfLifeDays !== null && Number.isFinite(halfLifeDays) ? halfLifeDays : null,
  }
}

// ---------------------------------------------------------------------------
// Monte Carlo Lab: IID bootstrap of daily returns
// ---------------------------------------------------------------------------

export interface MonteCarloStats {
  paths: number
  horizonDays: number
  sampleDays: number
  /** Percentiles of forward max drawdown (negative %, P5 = mildest). */
  maxDrawdownPct: { p5: number; p25: number; p50: number; p75: number; p95: number }
  /** Percentiles of terminal simple return %. */
  terminalReturnPct: { p5: number; p25: number; p50: number; p75: number; p95: number }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[idx]
}

/** Deterministic LCG so re-renders produce stable results per seed. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function runDrawdownBootstrap(
  returns: number[],
  options?: { paths?: number; horizonDays?: number; seed?: number },
): MonteCarloStats | null {
  if (returns.length < 60) return null
  const paths = Math.min(options?.paths ?? 300, 500)
  const horizonDays = Math.min(options?.horizonDays ?? 126, 252)
  const rng = makeRng(options?.seed ?? 42)

  const maxDrawdowns: number[] = []
  const terminals: number[] = []
  for (let p = 0; p < paths; p += 1) {
    let equity = 1
    let peak = 1
    let maxDd = 0
    for (let d = 0; d < horizonDays; d += 1) {
      const r = returns[Math.floor(rng() * returns.length)]
      equity *= 1 + r
      if (equity > peak) peak = equity
      const dd = equity / peak - 1
      if (dd < maxDd) maxDd = dd
    }
    maxDrawdowns.push(maxDd * 100)
    terminals.push((equity - 1) * 100)
  }
  maxDrawdowns.sort((a, b) => a - b)
  terminals.sort((a, b) => a - b)

  return {
    paths,
    horizonDays,
    sampleDays: returns.length,
    maxDrawdownPct: {
      // maxDrawdowns ascending = worst first; P5 mildest means take from the top.
      p5: percentile(maxDrawdowns, 0.95),
      p25: percentile(maxDrawdowns, 0.75),
      p50: percentile(maxDrawdowns, 0.5),
      p75: percentile(maxDrawdowns, 0.25),
      p95: percentile(maxDrawdowns, 0.05),
    },
    terminalReturnPct: {
      p5: percentile(terminals, 0.05),
      p25: percentile(terminals, 0.25),
      p50: percentile(terminals, 0.5),
      p75: percentile(terminals, 0.75),
      p95: percentile(terminals, 0.95),
    },
  }
}
