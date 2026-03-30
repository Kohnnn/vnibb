export interface RegimeFacet {
  label: string
  shortLabel: string
  tone: string
  score: number
}

export interface QuantRegimeSummary {
  hurst: number | null
  structure: RegimeFacet
  volatility: RegimeFacet
  momentum: RegimeFacet
  regimeLabel: string
  action: string
}

export interface QuantRegimeInput {
  hurst: number | null
  volatilityRegime?: string | null
  volatilityZScore?: number | null
  momentumScore?: number | null
  momentumLabel?: string | null
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function average(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function std(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

export function computeHurstFromPrices(prices: number[]): number | null {
  if (prices.length < 120) return null

  const logPrices = prices.map((price) => Math.log(price)).filter((value) => Number.isFinite(value))
  if (logPrices.length < 120) return null

  const lags = Array.from({ length: 24 }, (_, index) => index + 2)
  const pairs: Array<{ lag: number; tau: number }> = []

  for (const lag of lags) {
    const diffs: number[] = []
    for (let index = lag; index < logPrices.length; index += 1) {
      diffs.push(logPrices[index] - logPrices[index - lag])
    }
    const tau = std(diffs)
    if (Number.isFinite(tau) && tau > 0) {
      pairs.push({ lag, tau })
    }
  }

  if (pairs.length < 6) return null

  const x = pairs.map((pair) => Math.log(pair.lag))
  const y = pairs.map((pair) => Math.log(pair.tau))
  const xMean = average(x)
  const yMean = average(y)
  if (xMean === null || yMean === null) return null

  let numerator = 0
  let denominator = 0
  for (let index = 0; index < x.length; index += 1) {
    numerator += (x[index] - xMean) * (y[index] - yMean)
    denominator += (x[index] - xMean) ** 2
  }

  if (!Number.isFinite(denominator) || denominator === 0) return null
  const hurst = (numerator / denominator) * 2
  if (!Number.isFinite(hurst)) return null

  return clamp(hurst, 0, 1)
}

export function classifyHurst(hurst: number | null): RegimeFacet {
  if (hurst === null) {
    return {
      label: 'Insufficient Data',
      shortLabel: 'Balanced',
      tone: 'text-[var(--text-secondary)]',
      score: 50,
    }
  }

  if (hurst > 0.55) {
    return {
      label: 'Trending',
      shortLabel: 'Trending',
      tone: 'text-emerald-300',
      score: clamp(hurst * 100, 0, 100),
    }
  }

  if (hurst < 0.45) {
    return {
      label: 'Mean-Reverting',
      shortLabel: 'Mean-Rev',
      tone: 'text-amber-300',
      score: clamp((1 - hurst) * 100, 0, 100),
    }
  }

  return {
    label: 'Random Walk',
    shortLabel: 'Balanced',
    tone: 'text-cyan-300',
    score: 55,
  }
}

export function classifyVolatility(
  regime?: string | null,
  zScore?: number | null,
): RegimeFacet {
  const normalized = String(regime || '').trim().toLowerCase()

  if (normalized === 'low') {
    return { label: 'Low Volatility', shortLabel: 'Low-Vol', tone: 'text-emerald-300', score: 82 }
  }
  if (normalized === 'high') {
    return { label: 'High Volatility', shortLabel: 'High-Vol', tone: 'text-amber-300', score: 38 }
  }
  if (normalized === 'extreme') {
    return { label: 'Extreme Volatility', shortLabel: 'Extreme-Vol', tone: 'text-rose-300', score: 18 }
  }

  if (typeof zScore === 'number' && Number.isFinite(zScore)) {
    if (zScore <= -0.5) {
      return { label: 'Low Volatility', shortLabel: 'Low-Vol', tone: 'text-emerald-300', score: 78 }
    }
    if (zScore >= 1.5) {
      return { label: 'High Volatility', shortLabel: 'High-Vol', tone: 'text-amber-300', score: 34 }
    }
  }

  return { label: 'Normal Volatility', shortLabel: 'Normal-Vol', tone: 'text-cyan-300', score: 60 }
}

export function classifyMomentum(
  trendLabel?: string | null,
  momentumScore?: number | null,
): RegimeFacet {
  const text = String(trendLabel || '').toLowerCase()
  const score = typeof momentumScore === 'number' && Number.isFinite(momentumScore) ? momentumScore : 0
  const normalizedScore = clamp(((score + 4) / 8) * 100, 0, 100)

  if (text.includes('strong uptrend') || text.includes('bull') || score >= 3) {
    return { label: trendLabel || 'Strong Uptrend', shortLabel: 'Bull', tone: 'text-emerald-300', score: Math.max(normalizedScore, 88) }
  }
  if (text.includes('uptrend') || score >= 1) {
    return { label: trendLabel || 'Uptrend', shortLabel: 'Bull', tone: 'text-cyan-300', score: Math.max(normalizedScore, 68) }
  }
  if (text.includes('strong downtrend') || text.includes('bear') || score <= -3) {
    return { label: trendLabel || 'Strong Downtrend', shortLabel: 'Bear', tone: 'text-rose-300', score: Math.min(normalizedScore, 20) }
  }
  if (text.includes('downtrend') || score <= -1) {
    return { label: trendLabel || 'Downtrend', shortLabel: 'Bear', tone: 'text-amber-300', score: Math.min(normalizedScore, 38) }
  }

  return { label: trendLabel || 'Sideways', shortLabel: 'Neutral', tone: 'text-[var(--text-secondary)]', score: 52 }
}

export function buildQuantRegimeLabel(input: QuantRegimeInput): string {
  const structure = classifyHurst(input.hurst)
  const volatility = classifyVolatility(input.volatilityRegime, input.volatilityZScore)
  const momentum = classifyMomentum(input.momentumLabel, input.momentumScore)
  return `${structure.shortLabel} ${volatility.shortLabel} ${momentum.shortLabel}`
}

export function buildQuantAction(regime: QuantRegimeInput): string {
  const structure = classifyHurst(regime.hurst)
  const volatility = classifyVolatility(regime.volatilityRegime, regime.volatilityZScore)
  const momentum = classifyMomentum(regime.momentumLabel, regime.momentumScore)

  if (momentum.shortLabel === 'Bull' && volatility.shortLabel === 'Low-Vol') {
    return 'Momentum setups favor breakouts with wider swing targets.'
  }
  if (momentum.shortLabel === 'Bear' && volatility.shortLabel !== 'Low-Vol') {
    return 'Tighten risk and prefer defense until trend pressure cools.'
  }
  if (structure.shortLabel === 'Mean-Rev') {
    return 'Fade stretch moves and wait for reversion entries near support or resistance.'
  }
  return 'Stay selective and confirm moves with volume before adding size.'
}

export function buildQuantRegimeSummary(input: QuantRegimeInput): QuantRegimeSummary {
  const structure = classifyHurst(input.hurst)
  const volatility = classifyVolatility(input.volatilityRegime, input.volatilityZScore)
  const momentum = classifyMomentum(input.momentumLabel, input.momentumScore)

  return {
    hurst: input.hurst,
    structure,
    volatility,
    momentum,
    regimeLabel: `${structure.shortLabel} ${volatility.shortLabel} ${momentum.shortLabel}`,
    action: buildQuantAction(input),
  }
}

export function quantPeriodToStartDate(period: string): string {
  const end = new Date()
  if (period === '1M') end.setDate(end.getDate() - 35)
  else if (period === '6M') end.setMonth(end.getMonth() - 7)
  else if (period === '1Y') end.setFullYear(end.getFullYear() - 2)
  else if (period === '3Y') end.setFullYear(end.getFullYear() - 4)
  else if (period === '5Y') end.setFullYear(end.getFullYear() - 6)
  else end.setFullYear(end.getFullYear() - 8)

  return end.toISOString().slice(0, 10)
}

export function scoreSortino(sortinoAverage: number | null): number {
  if (sortinoAverage === null || !Number.isFinite(sortinoAverage)) return 50
  return clamp(((sortinoAverage + 1) / 4) * 100, 0, 100)
}

export function scoreSeasonality(hitRatePct: number | null): number {
  if (hitRatePct === null || !Number.isFinite(hitRatePct)) return 50
  return clamp(hitRatePct, 0, 100)
}

export function scoreFlow(currentDelta: number | null, cumulativeDeltas: Array<number | null>): number {
  if (currentDelta === null || !Number.isFinite(currentDelta)) return 50
  const maxAbs = Math.max(
    Math.abs(currentDelta),
    ...cumulativeDeltas.map((value) => Math.abs(Number(value || 0))),
    1,
  )
  return clamp(50 + (currentDelta / maxAbs) * 50, 0, 100)
}

export function scoreDrawdown(maxDrawdownPct: number | null, recoveryDays: number | null): number {
  const drawdownPenalty = Math.min(Math.abs(Number(maxDrawdownPct || 0)) * 1.35, 70)
  const recoveryPenalty = Math.min(Number(recoveryDays || 0) / 3, 25)
  return clamp(100 - drawdownPenalty - recoveryPenalty, 0, 100)
}

export function scoreEmaRespect(
  emaLevels: Array<{ support_bounce_rate_pct?: number | null; support_strength?: string | null }>,
): number {
  if (!emaLevels.length) return 50
  const bounceRates = emaLevels
    .map((level) => Number(level.support_bounce_rate_pct))
    .filter((value) => Number.isFinite(value))
  const bounceScore = average(bounceRates) ?? 50
  const strengthScore = average(
    emaLevels.map((level) => {
      const strength = String(level.support_strength || '').toLowerCase()
      if (strength === 'strong') return 90
      if (strength === 'moderate') return 70
      if (strength === 'weak') return 45
      if (strength === 'fragile') return 25
      return 50
    }),
  ) ?? 50

  return clamp(bounceScore * 0.6 + strengthScore * 0.4, 0, 100)
}
