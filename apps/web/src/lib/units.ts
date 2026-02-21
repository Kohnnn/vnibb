export type UnitDisplay = 'auto' | 'raw' | 'K' | 'M' | 'B'

export interface UnitConfig {
  display: UnitDisplay
  decimalPlaces: number
  currency?: string
  locale?: string
}

export const EMPTY_VALUE = '—'

export const DEFAULT_UNIT_CONFIG: UnitConfig = {
  display: 'auto',
  decimalPlaces: 2,
  currency: 'VND',
  locale: 'en-US'
}

const VALID_DISPLAYS: UnitDisplay[] = ['auto', 'raw', 'K', 'M', 'B']

export function normalizeUnitConfig(value?: Partial<UnitConfig> | null): UnitConfig {
  if (!value) return DEFAULT_UNIT_CONFIG

  const display = VALID_DISPLAYS.includes(value.display as UnitDisplay)
    ? (value.display as UnitDisplay)
    : DEFAULT_UNIT_CONFIG.display
  const decimalPlaces = Number.isFinite(value.decimalPlaces)
    ? Math.max(0, Math.min(3, Math.round(value.decimalPlaces as number)))
    : DEFAULT_UNIT_CONFIG.decimalPlaces
  const currency = typeof value.currency === 'string' ? value.currency : DEFAULT_UNIT_CONFIG.currency
  const locale = typeof value.locale === 'string' ? value.locale : DEFAULT_UNIT_CONFIG.locale

  return {
    display,
    decimalPlaces,
    currency,
    locale
  }
}

export function formatUnitValue(
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
    case 'auto':
    default:
      if (abs >= 1e9) return formatScaled(1e9, 'B')
      if (abs >= 1e6) return formatScaled(1e6, 'M')
      if (abs >= 1e3) return formatScaled(1e3, 'K')
      return `${sign}${formatRaw(abs)}`
  }
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

export function formatAxisValue(value: number, config: UnitConfig = DEFAULT_UNIT_CONFIG): string {
  const formatted = formatUnitValue(value, { ...config, decimalPlaces: 2 })
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
    case 'auto':
    default:
      return 'Auto'
  }
}

export function getUnitCaption(config: UnitConfig): string {
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
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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
  if (!isFiniteNumber(value)) return EMPTY_VALUE

  const mode = options.input ?? 'auto'
  const normalized = mode === 'ratio'
    ? value * 100
    : mode === 'percent'
      ? value
      : Math.abs(value) <= 1
        ? value * 100
        : value

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
