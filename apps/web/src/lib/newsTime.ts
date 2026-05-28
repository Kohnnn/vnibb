import { parseFlexibleDate } from './format'

export function normalizeNewsTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    const millis = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(millis)
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
  }

  const text = String(value).trim()
  if (!text) return null

  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
    const parsed = new Date(millis)
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
  }

  const parsed = new Date(text)
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString()

  const flexible = parseFlexibleDate(text)
  return flexible ? flexible.toISOString() : text
}

export function normalizeNewsItemTimestamp(item: Record<string, unknown>): string | null {
  return normalizeNewsTimestamp(
    item.published_at
      ?? item.published_date
      ?? item.publishedDate
      ?? item.pubDate
      ?? item.created_at
      ?? item.timestamp
      ?? item.date
  )
}
