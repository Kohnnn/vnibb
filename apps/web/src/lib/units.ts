export type UnitDisplay = 'auto' | 'raw' | 'K' | 'M' | 'B' | 'USD'

export interface UnitConfig {
  display: UnitDisplay
  decimalPlaces: number
  currency?: string
  locale?: string
  usdVndDefaultRate?: number
  usdVndRatesByYear?: Record<string, number>
}

export const EMPTY_VALUE = '—'
export const DEFAULT_USD_VND_RATE = 25_000
export const DEFAULT_USD_VND_RATES_BY_YEAR: Record<string, number> = {
  '2016': 22_300,
  '2017': 22_700,
  '2018': 23_200,
  '2019': 23_250,
  '2020': 23_200,
  '2021': 22_950,
  '2022': 23_600,
  '2023': 23_850,
  '2024': 25_000,
  '2025': 25_500,
  '2026': 26_000,
}

export const DEFAULT_UNIT_CONFIG: UnitConfig = {
  display: 'auto',
  decimalPlaces: 2,
  currency: 'VND',
  locale: 'en-US',
  usdVndDefaultRate: DEFAULT_USD_VND_RATE,
  usdVndRatesByYear: DEFAULT_USD_VND_RATES_BY_YEAR,
}

const VALID_DISPLAYS: UnitDisplay[] = ['auto', 'raw', 'K', 'M', 'B', 'USD']

function normalizeUsdVndRatesByYear(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown] => /^20\d{2}$/.test(entry[0]))
      .map(([year, rate]) => {
        const parsed = Number(rate)
        return [year, Number.isFinite(parsed) && parsed > 0 ? parsed : null] as const
      })
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  )
}

export function normalizeUnitConfig(value?: Partial<UnitConfig> | null): UnitConfig {
  if (!value) return DEFAULT_UNIT_CONFIG

  const display = VALID_DISPLAYS.includes(value.display as UnitDisplay)
    ? (value.display as UnitDisplay)
    : DEFAULT_UNIT_CONFIG.display
  const decimalPlaces = Number.isFinite(value.decimalPlaces)
    ? Math.max(0, Math.min(3, Math.round(value.decimalPlaces as number)))
    : DEFAULT_UNIT_CONFIG.decimalPlaces
  const currency = display === 'USD'
    ? 'USD'
    : typeof value.currency === 'string'
      ? value.currency
      : DEFAULT_UNIT_CONFIG.currency
  const locale = typeof value.locale === 'string' ? value.locale : DEFAULT_UNIT_CONFIG.locale
  const usdVndDefaultRate = Number.isFinite(value.usdVndDefaultRate)
    ? Math.max(1, Number(value.usdVndDefaultRate))
    : DEFAULT_UNIT_CONFIG.usdVndDefaultRate
  const usdVndRatesByYear = normalizeUsdVndRatesByYear(value.usdVndRatesByYear)

  return {
    display,
    decimalPlaces,
    currency,
    locale,
    usdVndDefaultRate,
    usdVndRatesByYear,
  }
}

export function extractFinancialPeriodYear(value: string | number | null | undefined): number | null {
  const text = String(value ?? '').trim().toUpperCase()
  if (!text) return null
  const match = text.match(/(20\d{2})/)
  return match ? Number(match[1]) : null
}

export function resolveUsdVndRate(
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  year?: number | null,
): number {
  const normalizedConfig = normalizeUnitConfig(config)
  if (year && normalizedConfig.usdVndRatesByYear?.[String(year)]) {
    return normalizedConfig.usdVndRatesByYear[String(year)]
  }
  return normalizedConfig.usdVndDefaultRate || DEFAULT_USD_VND_RATE
}

export function convertFinancialValueForUnit(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  periodOrYear?: string | number | null,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const normalizedConfig = normalizeUnitConfig(config)
  if (normalizedConfig.display !== 'USD') return value

  const year = typeof periodOrYear === 'number' ? periodOrYear : extractFinancialPeriodYear(periodOrYear)
  const rate = resolveUsdVndRate(normalizedConfig, year)
  return rate > 0 ? value / rate : value
}

export function convertCurrentValueForUnit(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
): number | null {
  return convertFinancialValueForUnit(value, config, null)
}

export function formatCompactValueForUnit(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  options: NumberFormatOptions = {}
): string {
  const converted = convertCurrentValueForUnit(value, config)
  return formatLargeNumber(converted, options)
}

export function formatPriceValueForUnit(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  options: NumberFormatOptions = {}
): string {
  const converted = convertCurrentValueForUnit(value, config)
  return formatNumber(converted, { decimals: options.decimals ?? 2, locale: options.locale, useGrouping: options.useGrouping })
}

/**
 * Format a value that is ALREADY expressed in the configured display unit.
 *
 * The FX boundary is `convertFinancialValueForUnit`: callers convert once and then
 * format here. Formatting must never divide by the rate again, or one quantity
 * renders at two magnitudes (axis vs tooltip vs table).
 */
export function formatDisplayValue(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE

  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  const decimals = config.decimalPlaces
  const locale = config.locale || 'en-US'

  const formatRaw = (num: number) =>
    num.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })

  const formatScaled = (divisor: number, suffix: string) =>
    `${sign}${(abs / divisor).toFixed(decimals)}${suffix}`

  switch (config.display) {
    case 'raw':
      return `${sign}${formatRaw(abs)}`
    case 'K':
      return formatScaled(1e3, 'K')
    case 'M':
      return formatScaled(1e6, 'M')
    case 'B':
      return formatScaled(1e9, 'B')
    case 'USD':
    case 'auto':
    default:
      if (abs >= 1e9) return formatScaled(1e9, 'B')
      if (abs >= 1e6) return formatScaled(1e6, 'M')
      if (abs >= 1e3) return formatScaled(1e3, 'K')
      return `${sign}${formatRaw(abs)}`
  }
}

/**
 * Convert a raw (VND) value once and format it in the configured display unit.
 * Use this for raw payload values; use `formatDisplayValue` for values that a
 * caller has already converted (chart series, tooltips, table cells).
 */
export function formatUnitValue(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE
  return formatDisplayValue(convertFinancialValueForUnit(value, config), config)
}

/** Currency suffix for an already-converted value (e.g. ' USD'). */
export function getConvertedUnitSuffix(config: UnitConfig = DEFAULT_UNIT_CONFIG): string {
  const normalized = normalizeUnitConfig(config)
  if (normalized.display === 'USD') return ' USD'
  return normalized.currency ? ` ${normalized.currency}` : ''
}

/** Compact label for an already-converted value, e.g. `2.09 B USD`. */
export function formatConvertedValue(
  value: number | null | undefined,
  config: UnitConfig = DEFAULT_UNIT_CONFIG
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE
  return `${formatDisplayValue(value, config)}${getConvertedUnitSuffix(config)}`
}

export interface UnitScale {
  divisor: number
  suffix: '' | 'K' | 'M' | 'B'
}

export function resolveUnitScale(values: Array<number | null | undefined>, config: UnitConfig): UnitScale {
  const finite = values.filter((value) => Number.isFinite(value as number)) as number[]
  const maxAbs = finite.length ? Math.max(...finite.map((value) => Math.abs(value))) : 0

  if (config.display === 'raw') return { divisor: 1, suffix: '' }
  if (config.display === 'K') return { divisor: 1e3, suffix: 'K' }
  if (config.display === 'M') return { divisor: 1e6, suffix: 'M' }
  if (config.display === 'B') return { divisor: 1e9, suffix: 'B' }

  if (maxAbs >= 1e9) return { divisor: 1e9, suffix: 'B' }
  if (maxAbs >= 1e6) return { divisor: 1e6, suffix: 'M' }
  if (maxAbs >= 1e3) return { divisor: 1e3, suffix: 'K' }
  return { divisor: 1, suffix: '' }
}

export function formatUnitValuePlain(
  value: number | null | undefined,
  scale: UnitScale,
  config: UnitConfig = DEFAULT_UNIT_CONFIG
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE

  const locale = config.locale || 'en-US'
  const decimals = config.decimalPlaces
  const scaled = value / scale.divisor

  return scaled.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

/**
 * Format a RAW (VND) value against a scale resolved from already-converted
 * values: convert once here, then divide. The flow charts (income Sankey, cash
 * waterfall) build their model from raw statement rows, so formatting those
 * values with `formatUnitValuePlain` divided raw VND by a USD-derived scale and
 * overstated the magnitude by the FX rate (issue #100).
 *
 * `periodOrYear` is the fiscal period of the row being formatted. Without it the
 * conversion falls back to the current FX rate, so a fiscal-2025 value would be
 * formatted at a different rate than the scale it is divided by.
 */
export function formatRawValuePlain(
  value: number | null | undefined,
  scale: UnitScale,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  periodOrYear?: string | number | null
): string {
  return formatUnitValuePlain(convertFinancialValueForUnit(value, config, periodOrYear), scale, config)
}

export function getUnitLegend(scale: UnitScale, config: UnitConfig): string {
  const currency = config.currency ? ` ${config.currency}` : ''
  if (!scale.suffix) return `Values in${currency}`.trim()

  const label = scale.suffix === 'K'
    ? 'Thousands'
    : scale.suffix === 'M'
      ? 'Millions'
      : 'Billions'

  return `Values in ${label}${currency}`
}

/**
 * Axis tick label. Pass `{ converted:true }` when the tick value already came
 * out of `convertFinancialValueForUnit` (chart series), so it is not converted twice.
 */
export function formatAxisValue(
  value: number,
  config: UnitConfig = DEFAULT_UNIT_CONFIG,
  options: { converted?: boolean } = {}
): string {
  const scaledConfig = { ...config, decimalPlaces: 2 }
  const formatted = options.converted
    ? formatDisplayValue(value, scaledConfig)
    : formatUnitValue(value, scaledConfig)
  return formatted.replace(/([0-9])([KMB])$/, '$1 $2')
}

export function getUnitLabel(config: UnitConfig): string {
  switch (config.display) {
    case 'raw':
      return 'Raw'
    case 'K':
      return 'K'
    case 'M':
      return 'M'
    case 'B':
      return 'B'
    case 'USD':
      return 'USD'
    case 'auto':
    default:
      return 'Auto'
  }
}

export function getUnitCaption(config: UnitConfig): string {
  if (config.display === 'USD') {
    return 'USD'
  }
  const label = getUnitLabel(config)
  const currency = config.currency ? ` ${config.currency}` : ''
  return `${label}${currency}`.trim()
}

interface NumberFormatOptions {
  decimals?: number
  locale?: string
  useGrouping?: boolean
}

interface PercentFormatOptions {
  decimals?: number
  locale?: string
  input?: 'auto' | 'ratio' | 'percent'
  clamp?: 'yoy_change' | 'margin' | 'yield' | 'ratio'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Narrow an unvalidated value (chart tooltip payload, provider cell) to a finite
 * number, else null. Tooltip callbacks receive `string | number | Array<...> |
 * undefined`, so callers must not assume a number.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value)) return value.length > 0 ? toFiniteNumber(value[0]) : null
  return null
}

export function clampPercentage(
  value: number | null | undefined,
  type: 'yoy_change' | 'margin' | 'yield' | 'ratio' = 'yoy_change'
): number | null {
  if (!isFiniteNumber(value)) return null

  const limits: Record<'yoy_change' | 'margin' | 'yield' | 'ratio', [number, number]> = {
    yoy_change: [-999, 999],
    margin: [-200, 200],
    yield: [-100, 100],
    ratio: [-1000, 1000],
  }

  const [min, max] = limits[type]
  if (value < min || value > max) return null
  return value
}

export function normalizePercentValue(
  value: number | null | undefined,
  options: Pick<PercentFormatOptions, 'input' | 'clamp'> = {}
): number | null {
  if (!isFiniteNumber(value)) return null

  const mode = options.input ?? 'auto'
  let normalized = mode === 'ratio'
    ? value * 100
    : mode === 'percent'
      ? value
      : Math.abs(value) <= 1
        ? value * 100
        : value

  if (options.clamp === 'margin' || options.clamp === 'yield') {
    const threshold = options.clamp === 'margin' ? 200 : 100
    while (Math.abs(normalized) > threshold && Math.abs(normalized / 100) <= threshold) {
      normalized /= 100
    }
  }

  return options.clamp ? clampPercentage(normalized, options.clamp) : normalized
}

/**
 * Percent change using the absolute prior-period value as the denominator - the
 * project convention, and the one the API's growth payload uses. Dividing by
 * `|previous|` makes a swing from a negative base to a positive one read as a
 * POSITIVE number. Dividing by the signed `previous` instead disagrees in sign
 * whenever the prior value is negative, which is how one fiscal year rendered as
 * +100.7% in the statement table and -100.7% in the growth widget (issue #104).
 *
 * The absolute denominator is deliberately the only option: a second convention
 * in this helper is what let the two surfaces drift apart.
 *
 * A negative prior value still makes the percentage unreadable as ordinary
 * growth, so `percentChangeDetail` classifies the pair and callers MUST render
 * that classification rather than labelling every negative-base cell as one
 * undifferentiated "turnaround": a loss that narrowed is not a loss that flipped
 * to profit.
 */
export function calculatePercentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: {
    minimumBase?: number
    clamp?: 'yoy_change' | 'margin' | 'yield' | 'ratio'
  } = {}
): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null

  const minimumBase = options.minimumBase ?? 0.001
  if (Math.abs(previous) < minimumBase) return null

  const change = ((current - previous) / Math.abs(previous)) * 100
  return options.clamp ? clampPercentage(change, options.clamp) : change
}

/** How a comparison reads once a negative endpoint is accounted for. */
export type PercentChangeBasis =
  | 'growth'
  | 'loss-to-profit'
  | 'loss-narrowed'
  | 'loss-widened'
  | 'profit-to-loss'

export interface PercentChangeDetail {
  change: number | null
  /** True when an endpoint was negative, so the sign is not ordinary growth. */
  hasNegativeBase: boolean
  basis: PercentChangeBasis
  /** Short visible tag for `basis`, or null for ordinary same-sign growth. */
  label: string | null
}

const PERCENT_CHANGE_LABELS: Record<PercentChangeBasis, string | null> = {
  growth: null,
  'loss-to-profit': 'to profit',
  'loss-narrowed': 'loss narrowed',
  'loss-widened': 'loss widened',
  'profit-to-loss': 'to loss',
}

function classifyPercentChange(current: number, previous: number): PercentChangeBasis {
  if (previous < 0 && current > 0) return 'loss-to-profit'
  if (previous < 0) {
    if (current === previous) return 'growth'
    return current > previous ? 'loss-narrowed' : 'loss-widened'
  }
  if (current < 0) return 'profit-to-loss'
  return 'growth'
}

export function percentChangeDetail(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: {
    minimumBase?: number
    clamp?: 'yoy_change' | 'margin' | 'yield' | 'ratio'
  } = {}
): PercentChangeDetail {
  const hasNegativeBase = isFiniteNumber(previous) && (previous < 0 || (previous > 0 && isFiniteNumber(current) && current < 0))
  const basis = isFiniteNumber(current) && isFiniteNumber(previous)
    ? classifyPercentChange(current, previous)
    : 'growth'
  return {
    change: calculatePercentChange(current, previous, options),
    hasNegativeBase,
    basis,
    label: hasNegativeBase ? PERCENT_CHANGE_LABELS[basis] : null,
  }
}

/**
 * Hover text for a classified change. Returns undefined for ordinary growth so
 * callers can omit the attribute entirely.
 */
export function describePercentChange(detail: PercentChangeDetail): string | undefined {
  if (!detail.hasNegativeBase) return undefined
  const denominator = 'This percentage divides by the absolute prior value.'
  switch (detail.basis) {
    case 'loss-to-profit':
      return `Prior period was a loss and the current period is profitable (loss to profit). ${denominator}`
    case 'loss-narrowed':
      return `Both periods are losses and the loss narrowed. ${denominator}`
    case 'loss-widened':
      return `Both periods are losses and the loss widened. ${denominator}`
    case 'profit-to-loss':
      return `Prior period was profitable and the current period is a loss (profit to loss). ${denominator}`
    default:
      return `Prior period was negative. ${denominator}`
  }
}

export function formatNumber(
  value: number | null | undefined,
  options: NumberFormatOptions = {}
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE

  const decimals = options.decimals ?? 2
  return value.toLocaleString(options.locale ?? 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: options.useGrouping ?? true,
  })
}

export function formatPercent(
  value: number | null | undefined,
  options: PercentFormatOptions = {}
): string {
  const normalized = normalizePercentValue(value, options)
  if (!isFiniteNumber(normalized)) return EMPTY_VALUE

  const decimals = options.decimals ?? 2
  const body = normalized.toLocaleString(options.locale ?? 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  })
  return `${body}%`
}

export function formatCurrency(
  value: number | null | undefined,
  currency = 'VND',
  options: NumberFormatOptions = {}
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE

  const decimals = options.decimals ?? 0
  return value.toLocaleString(options.locale ?? 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatVND(
  value: number | null | undefined,
  options: NumberFormatOptions = {}
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE

  const decimals = options.decimals ?? 0
  return `${formatNumber(value, { ...options, decimals })} ₫`
}

export function formatLargeNumber(
  value: number | null | undefined,
  options: NumberFormatOptions = {}
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE

  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  const decimals = options.decimals ?? 1

  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(decimals)}T`
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`

  return formatNumber(value, { ...options, decimals: options.decimals ?? 0 })
}

export function formatDateValue(
  value: string | number | Date | null | undefined,
  locale = 'en-GB'
): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE

  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE

  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}
