import type { ForeignTradingMeta, ShareholderData } from '@/types/equity'
import type { InsiderSentiment } from '@/types/insider'
import { qualifyForeignFlowWindow } from '@/lib/foreignFlowWindow'

interface ForeignTradingRow {
  date?: string | null
  buy_volume?: number | null
  sell_volume?: number | null
}

/** Sessions required before a foreign-flow total may be labelled "20D". */
export const FOREIGN_WINDOW_SESSIONS = 20

export interface ForeignFlowCoverage {
  /** Sessions the consumer asked for; `FOREIGN_WINDOW_SESSIONS` by default. */
  requestedSessions: number
  /** Distinct qualifying sessions actually observed. */
  observedSessions: number | null
  /** Observed range, from the admitted rows (not from the row count). */
  startDate: string | null
  endDate: string | null
  lastValidatedSession: string | null
  gapSessions: number | null
  nullSessions: number | null
  requestedStartDate: string | null
  requestedEndDate: string | null
  windowVerified: boolean
  calendarVerified: boolean
  status: 'complete' | 'partial' | 'unavailable'
  /** Response-level degradation text, kept even when rows were retained. */
  warning: string | null
}

export interface OwnershipSummary {
  score: number | null
  grade: 'A' | 'B' | 'C' | 'D' | null
  stance: string | null
  top3Pct: number | null
  top10Pct: number | null
  holderCount: number | null
  institutionalCount: number | null
  foreignCount: number | null
  insiderCount: number | null
  /** Only set when the requested session window is fully covered. */
  foreignNetVolume: number | null
  foreignFlowCoverage: ForeignFlowCoverage
  insiderNetValue: number | null
  availableSources: number
  coverage: 'complete' | 'partial' | 'unknown'
  ownershipUnit: 'percent' | null
  ownershipUnitStatus: 'explicit' | 'unverified'
  ownershipSourceFields: string[]
  ownershipSources: string[]
}

export function readAdmittedOwnershipPct(holder: ShareholderData): number | null {
  const value = holder.ownership_pct
  return holder.ownership_unit === 'percent' && holder.ownership_unit_status === 'explicit'
    && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : null
}

function classifyHolderType(type: string | null | undefined): 'institutional' | 'foreign' | 'insider' | 'other' {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('foreign') || normalized.includes('state')) return 'foreign'
  if (normalized.includes('fund') || normalized.includes('institution') || normalized.includes('company')) return 'institutional'
  if (normalized.includes('insider') || normalized.includes('executive') || normalized.includes('management')) return 'insider'
  return 'other'
}

function gradeFromScore(score: number): OwnershipSummary['grade'] {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

export function buildOwnershipSummary(
  shareholders: ShareholderData[] | null | undefined,
  foreignTrading: ForeignTradingRow[] | null | undefined,
  insiderSentiment: InsiderSentiment | null | undefined,
  foreignMeta?: ForeignTradingMeta | null,
): OwnershipSummary {
  const holders = shareholders ?? []
  const normalizedOwnership = holders
    .map(readAdmittedOwnershipPct)
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left)
  const hasConcentration = holders.length > 0 && normalizedOwnership.length === holders.length

  const top3Pct = hasConcentration ? normalizedOwnership.slice(0, 3).reduce((sum, value) => sum + value, 0) : null
  const top10Pct = hasConcentration ? normalizedOwnership.slice(0, 10).reduce((sum, value) => sum + value, 0) : null

  let institutionalCount = 0
  let foreignCount = 0
  let insiderCount = 0
  holders.forEach((holder) => {
    const bucket = classifyHolderType(holder.shareholder_type)
    if (bucket === 'institutional') institutionalCount += 1
    if (bucket === 'foreign') foreignCount += 1
    if (bucket === 'insider') insiderCount += 1
  })

  const foreignWindow = qualifyForeignFlowWindow(foreignTrading, foreignMeta, FOREIGN_WINDOW_SESSIONS)
  const foreignFlowCoverage: ForeignFlowCoverage = {
    requestedSessions: FOREIGN_WINDOW_SESSIONS,
    observedSessions: foreignWindow.observed,
    startDate: foreignWindow.returnedStart,
    endDate: foreignWindow.returnedEnd,
    lastValidatedSession: foreignWindow.lastValidated,
    gapSessions: foreignWindow.gaps,
    nullSessions: foreignWindow.nullSessions,
    requestedStartDate: foreignWindow.requestedStart,
    requestedEndDate: foreignWindow.requestedEnd,
    windowVerified: foreignWindow.windowed,
    calendarVerified: foreignWindow.calendarVerified,
    status: !foreignWindow.rows.length ? 'unavailable' : foreignWindow.complete ? 'complete' : 'partial',
    warning: foreignWindow.windowed ? null : 'Retained history is not a verified session window',
  }
  const foreignNetVolume = foreignWindow.total
  const insiderNetValue = insiderSentiment?.value_unit === 'VND'
    && typeof insiderSentiment.net_value === 'number' && Number.isFinite(insiderSentiment.net_value)
    ? insiderSentiment.net_value
    : null
  const hasShareholders = holders.length > 0
  const availableSources = [hasShareholders, foreignNetVolume !== null, insiderNetValue !== null].filter(Boolean).length
  const complete = hasConcentration && foreignNetVolume !== null && insiderNetValue !== null

  let score = 50
  if (top3Pct !== null) {
    if (top3Pct >= 75) score -= 14
    else if (top3Pct >= 50) score += 8
    else score += 12
  }
  if (top10Pct !== null) {
    if (top10Pct >= 90) score -= 8
    else if (top10Pct >= 65) score += 6
  }
  if (institutionalCount >= 2) score += 8
  if (foreignCount >= 1) score += 6
  if (foreignNetVolume !== null) {
    if (foreignNetVolume > 0) score += 8
    if (foreignNetVolume < 0) score -= 8
  }
  if (insiderNetValue !== null) {
    if (insiderNetValue > 0) score += 10
    if (insiderNetValue < 0) score -= 10
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const grade = gradeFromScore(score)
  let stance = 'Balanced ownership base'
  if (grade === 'A') stance = 'Constructive ownership profile'
  else if (grade === 'B') stance = 'Supported by anchor holders'
  else if (grade === 'D') stance = 'Fragile or concentrated base'

  return {
    score: complete ? score : null,
    grade: complete ? grade : null,
    stance: complete ? stance : null,
    top3Pct,
    top10Pct,
    holderCount: shareholders ? holders.length : null,
    institutionalCount: shareholders ? institutionalCount : null,
    foreignCount: shareholders ? foreignCount : null,
    insiderCount: shareholders ? insiderCount : null,
    foreignNetVolume,
    foreignFlowCoverage,
    insiderNetValue,
    availableSources,
    coverage: complete ? 'complete' : availableSources > 0 ? 'partial' : 'unknown',
    ownershipUnit: hasConcentration ? 'percent' : null,
    ownershipUnitStatus: hasConcentration ? 'explicit' : 'unverified',
    ownershipSourceFields: [...new Set(holders.flatMap((holder) => holder.ownership_source_field ? [holder.ownership_source_field] : []))],
    ownershipSources: [...new Set(holders.flatMap((holder) => holder.ownership_source ? [holder.ownership_source] : []))],
  }
}
