'use client'

import type { CompanyEventData, EquityHistoricalData } from '@/types/equity'

export interface ChartEventMarker {
  date: string
  shortLabel: 'D' | 'S' | 'R'
  label: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown' | 'circle'
  category: 'dividend' | 'split' | 'rights'
}

interface PricePointLike {
  time: string
}

function normalizeDateInput(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().split('T')[0]
}

function classifyEvent(event: CompanyEventData): Omit<ChartEventMarker, 'date'> | null {
  const category = String(event.action_category || event.event_type || '').trim().toLowerCase()
  const subtype = String(event.action_subtype || '').trim().toLowerCase()

  if (subtype === 'cash_dividend' || category === 'dividend') {
    return {
      shortLabel: 'D',
      label: 'Dividend',
      color: '#f59e0b',
      position: 'belowBar',
      shape: 'arrowDown',
      category: 'dividend',
    }
  }

  if (category === 'split') {
    return {
      shortLabel: 'S',
      label: 'Split',
      color: '#a78bfa',
      position: 'aboveBar',
      shape: 'arrowUp',
      category: 'split',
    }
  }

  if (subtype === 'rights_issue' || subtype === 'stock_dividend') {
    return {
      shortLabel: 'R',
      label: subtype === 'stock_dividend' ? 'Stock Dividend' : 'Rights Issue',
      color: '#22d3ee',
      position: 'aboveBar',
      shape: 'circle',
      category: 'rights',
    }
  }

  return null
}

function resolveEventDate(event: CompanyEventData): string | null {
  return (
    normalizeDateInput(event.effective_date)
    || normalizeDateInput(event.ex_date)
    || normalizeDateInput(event.event_date)
    || normalizeDateInput(event.record_date)
    || normalizeDateInput(event.payment_date)
  )
}

function alignToTradingDate(eventDate: string, tradingDates: string[]): string | null {
  const eventTime = new Date(eventDate).getTime()
  if (Number.isNaN(eventTime)) return null

  for (const tradingDate of tradingDates) {
    const tradingTime = new Date(tradingDate).getTime()
    if (Number.isNaN(tradingTime)) continue
    const gapDays = (tradingTime - eventTime) / (24 * 60 * 60 * 1000)
    if (gapDays >= 0 && gapDays <= 7) {
      return tradingDate
    }
  }

  return null
}

export function buildChartEventMarkers(
  events: CompanyEventData[],
  priceRows: Array<PricePointLike | EquityHistoricalData>,
  maxMarkers = 10,
): ChartEventMarker[] {
  if (!events.length || !priceRows.length) return []

  const tradingDates = priceRows
    .map((row) => normalizeDateInput(String(row.time)))
    .filter((value): value is string => Boolean(value))

  const deduped = new Map<string, ChartEventMarker>()

  for (const event of events) {
    const markerMeta = classifyEvent(event)
    if (!markerMeta) continue

    const eventDate = resolveEventDate(event)
    if (!eventDate) continue

    const alignedDate = alignToTradingDate(eventDate, tradingDates)
    if (!alignedDate) continue

    const key = `${alignedDate}:${markerMeta.shortLabel}`
    if (!deduped.has(key)) {
      deduped.set(key, {
        ...markerMeta,
        date: alignedDate,
      })
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(-maxMarkers)
}

export default buildChartEventMarkers
