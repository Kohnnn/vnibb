import type { ShareholderData } from '@/types/equity'
import type { InsiderSentiment } from '@/types/insider'

interface ForeignTradingRow {
  buy_volume?: number | null
  sell_volume?: number | null
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
  foreignNetVolume: number | null
  insiderNetValue: number | null
  availableSources: number
  coverage: 'complete' | 'partial' | 'unknown'
}

function normalizeOwnershipPct(holder: ShareholderData): number | null {
  const value = readOwnershipPct(holder)
  return value !== null && value >= 0 && value <= 100 ? value : null
}

function readOwnershipPct(holder: ShareholderData): number | null {
  const row = holder as ShareholderData & {
    percent?: number | null
    percentage?: number | null
  }
  const value = row.ownership_pct ?? row.percent ?? row.percentage
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
): OwnershipSummary {
  const holders = shareholders ?? []
  const normalizedOwnership = holders
    .map(normalizeOwnershipPct)
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

  const usableForeignRows = foreignTrading?.length && foreignTrading.every((row) =>
    typeof row.buy_volume === 'number' && Number.isFinite(row.buy_volume)
    && typeof row.sell_volume === 'number' && Number.isFinite(row.sell_volume))
  const foreignNetVolume = usableForeignRows
    ? foreignTrading!.reduce((sum, row) => sum + row.buy_volume! - row.sell_volume!, 0)
    : null
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
    insiderNetValue,
    availableSources,
    coverage: complete ? 'complete' : availableSources > 0 ? 'partial' : 'unknown',
  }
}
