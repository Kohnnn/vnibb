import type { ShareholderData } from '@/types/equity'
import type { InsiderSentiment } from '@/types/insider'

interface ForeignTradingRow {
  buy_volume?: number | null
  sell_volume?: number | null
}

export interface OwnershipSummary {
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  stance: string
  top3Pct: number | null
  top10Pct: number | null
  holderCount: number
  institutionalCount: number
  foreignCount: number
  insiderCount: number
  foreignNetVolume: number | null
  insiderNetValue: number | null
}

function normalizeOwnershipPct(value: number | null | undefined, treatAsRatio: boolean): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return treatAsRatio ? value * 100 : value
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
  shareholders: ShareholderData[],
  foreignTrading: ForeignTradingRow[],
  insiderSentiment: InsiderSentiment | null | undefined,
): OwnershipSummary {
  const ownershipValues = shareholders
    .map((holder) => holder.ownership_pct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const treatAsRatio = ownershipValues.length > 0 && ownershipValues.every((value) => Math.abs(value) <= 1)
  const normalizedOwnership = shareholders
    .map((holder) => normalizeOwnershipPct(holder.ownership_pct, treatAsRatio))
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left)

  const top3Pct = normalizedOwnership.length ? normalizedOwnership.slice(0, 3).reduce((sum, value) => sum + value, 0) : null
  const top10Pct = normalizedOwnership.length ? normalizedOwnership.slice(0, 10).reduce((sum, value) => sum + value, 0) : null

  let institutionalCount = 0
  let foreignCount = 0
  let insiderCount = 0
  shareholders.forEach((holder) => {
    const bucket = classifyHolderType(holder.shareholder_type)
    if (bucket === 'institutional') institutionalCount += 1
    if (bucket === 'foreign') foreignCount += 1
    if (bucket === 'insider') insiderCount += 1
  })

  const foreignNetVolume = foreignTrading.length
    ? foreignTrading.reduce((sum, row) => sum + (row.buy_volume || 0) - (row.sell_volume || 0), 0)
    : null
  const insiderNetValue = insiderSentiment?.net_value ?? null

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
    score,
    grade,
    stance,
    top3Pct,
    top10Pct,
    holderCount: shareholders.length,
    institutionalCount,
    foreignCount,
    insiderCount,
    foreignNetVolume,
    insiderNetValue,
  }
}
