'use client'

/**
 * Two-stage DCF and reverse-DCF math for the Valuation Lab widget.
 *
 * Pure, transparent functions — every output is a direct function of the user's
 * editable assumptions plus a base free-cash-flow figure. No backend endpoint;
 * the widget sources base inputs from existing `/equity` data and lets the user
 * override every assumption so the calculation stays auditable.
 */

export interface DcfAssumptions {
  /** Base annual free cash flow (currency units, e.g. VND billions). */
  baseFcf: number
  /** Stage-1 annual FCF growth, as a fraction (0.12 = 12%). */
  growthRate: number
  /** Number of explicit forecast years. */
  forecastYears: number
  /** Discount rate (WACC), as a fraction. */
  discountRate: number
  /** Perpetual terminal growth, as a fraction. */
  terminalGrowth: number
  /** Net debt (subtracted from EV to get equity value). Optional. */
  netDebt?: number
  /** Shares outstanding (same scale as FCF). */
  sharesOutstanding: number
}

export interface DcfYear {
  year: number
  fcf: number
  discountFactor: number
  presentValue: number
}

export interface DcfResult {
  years: DcfYear[]
  pvOfForecast: number
  terminalValue: number
  pvOfTerminal: number
  enterpriseValue: number
  equityValue: number
  intrinsicPerShare: number | null
  valid: boolean
  warning?: string
}

export function runDcf(a: DcfAssumptions): DcfResult {
  const years: DcfYear[] = []
  const forecastYears = Math.max(1, Math.min(Math.round(a.forecastYears), 20))

  // Guardrail: terminal growth must be below the discount rate for Gordon growth.
  const terminalValid = a.discountRate > a.terminalGrowth
  let pvOfForecast = 0
  let lastFcf = a.baseFcf

  for (let t = 1; t <= forecastYears; t += 1) {
    const fcf = a.baseFcf * (1 + a.growthRate) ** t
    const discountFactor = 1 / (1 + a.discountRate) ** t
    const presentValue = fcf * discountFactor
    years.push({ year: t, fcf, discountFactor, presentValue })
    pvOfForecast += presentValue
    lastFcf = fcf
  }

  const terminalFcf = lastFcf * (1 + a.terminalGrowth)
  const terminalValue = terminalValid ? terminalFcf / (a.discountRate - a.terminalGrowth) : 0
  const pvOfTerminal = terminalValid ? terminalValue / (1 + a.discountRate) ** forecastYears : 0

  const enterpriseValue = pvOfForecast + pvOfTerminal
  const equityValue = enterpriseValue - (a.netDebt ?? 0)
  const intrinsicPerShare = a.sharesOutstanding > 0 ? equityValue / a.sharesOutstanding : null

  return {
    years,
    pvOfForecast,
    terminalValue,
    pvOfTerminal,
    enterpriseValue,
    equityValue,
    intrinsicPerShare,
    valid: terminalValid && a.sharesOutstanding > 0 && Number.isFinite(a.baseFcf),
    warning: !terminalValid
      ? 'Terminal growth must be below the discount rate for a valid Gordon-growth terminal value.'
      : a.sharesOutstanding <= 0
        ? 'Shares outstanding is required to compute intrinsic value per share.'
        : undefined,
  }
}

/**
 * Reverse DCF: given the current market price, solve the constant stage-1 FCF
 * growth rate that the market is implying (holding the other assumptions fixed).
 * Uses bisection because intrinsic value is monotonic in growth.
 */
export function solveImpliedGrowth(
  a: Omit<DcfAssumptions, 'growthRate'>,
  currentPrice: number,
): number | null {
  if (currentPrice <= 0 || a.sharesOutstanding <= 0 || a.discountRate <= a.terminalGrowth) {
    return null
  }

  const valueAt = (g: number): number | null => runDcf({ ...a, growthRate: g }).intrinsicPerShare

  let lo = -0.5 // -50%
  let hi = 1.0 // +100%
  const vLo = valueAt(lo)
  const vHi = valueAt(hi)
  if (vLo === null || vHi === null) return null
  // If the price is outside the achievable band, clamp.
  if (currentPrice <= vLo) return lo
  if (currentPrice >= vHi) return hi

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2
    const v = valueAt(mid)
    if (v === null) return null
    if (Math.abs(v - currentPrice) < currentPrice * 1e-5) return mid
    if (v < currentPrice) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function dcfResultToRows(
  a: DcfAssumptions,
  result: DcfResult,
  currentPrice: number | null,
): Array<Record<string, string | number>> {
  const fmt = (v: number | null, digits = 2) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits))
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const upside =
    currentPrice && currentPrice > 0 && result.intrinsicPerShare !== null
      ? ((result.intrinsicPerShare - currentPrice) / currentPrice) * 100
      : null
  return [
    { field: 'Base FCF', value: fmt(a.baseFcf) },
    { field: 'Stage-1 growth', value: pct(a.growthRate) },
    { field: 'Forecast years', value: a.forecastYears },
    { field: 'Discount rate (WACC)', value: pct(a.discountRate) },
    { field: 'Terminal growth', value: pct(a.terminalGrowth) },
    { field: 'Net debt', value: fmt(a.netDebt ?? 0) },
    { field: 'Shares outstanding', value: fmt(a.sharesOutstanding) },
    { field: 'PV of forecast FCF', value: fmt(result.pvOfForecast) },
    { field: 'PV of terminal value', value: fmt(result.pvOfTerminal) },
    { field: 'Enterprise value', value: fmt(result.enterpriseValue) },
    { field: 'Equity value', value: fmt(result.equityValue) },
    { field: 'Intrinsic / share', value: fmt(result.intrinsicPerShare) },
    { field: 'Current price', value: fmt(currentPrice) },
    { field: 'Upside vs price %', value: upside === null ? '—' : upside.toFixed(1) },
  ]
}
