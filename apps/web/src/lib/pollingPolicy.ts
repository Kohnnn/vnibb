'use client'

import { focusManager, onlineManager } from '@tanstack/react-query'

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'
const MARKET_OPEN_MINUTES = [
  { start: 9 * 60, end: 11 * 60 + 30 },
  { start: 13 * 60, end: 15 * 60 },
] as const

export interface AdaptivePollingConfig {
  marketOpenMs: number
  marketClosedMs: number
  hiddenMs?: number | false
  offlineMs?: number | false
}

function getVietnamClock(date: Date = new Date()): {
  weekday: string
  hour: number
  minute: number
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)

  return { weekday, hour, minute }
}

export function isVietnamMarketOpen(date: Date = new Date()): boolean {
  const { weekday, hour, minute } = getVietnamClock(date)

  if (weekday === 'Sat' || weekday === 'Sun') {
    return false
  }

  const totalMinutes = hour * 60 + minute
  return MARKET_OPEN_MINUTES.some((window) => totalMinutes >= window.start && totalMinutes <= window.end)
}

export function getAdaptiveRefetchInterval(config: AdaptivePollingConfig): number | false {
  if (!onlineManager.isOnline()) {
    return config.offlineMs ?? false
  }

  const interval = isVietnamMarketOpen() ? config.marketOpenMs : config.marketClosedMs

  if (!focusManager.isFocused()) {
    return config.hiddenMs ?? false
  }

  return interval
}

export const POLLING_PRESETS = {
  marketOverview: {
    marketOpenMs: 20_000,
    marketClosedMs: 180_000,
    hiddenMs: false,
    offlineMs: false,
  },
  priceBoard: {
    marketOpenMs: 15_000,
    marketClosedMs: 300_000,
    hiddenMs: false,
    offlineMs: false,
  },
  quotes: {
    marketOpenMs: 30_000,
    marketClosedMs: 300_000,
    hiddenMs: false,
    offlineMs: false,
  },
  movers: {
    marketOpenMs: 60_000,
    marketClosedMs: 300_000,
    hiddenMs: false,
    offlineMs: false,
  },
  alerts: {
    marketOpenMs: 30_000,
    marketClosedMs: 180_000,
    hiddenMs: false,
    offlineMs: false,
  },
  news: {
    marketOpenMs: 300_000,
    marketClosedMs: 600_000,
    hiddenMs: false,
    offlineMs: false,
  },
  slowNews: {
    marketOpenMs: 1_800_000,
    marketClosedMs: 3_600_000,
    hiddenMs: false,
    offlineMs: false,
  },
  research: {
    marketOpenMs: 900_000,
    marketClosedMs: 1_800_000,
    hiddenMs: false,
    offlineMs: false,
  },
  foreignTrading: {
    // Foreign-trading data is computed at end-of-session and cached at the
    // provider layer for 60 minutes. Refetching faster than 5 min just bounces
    // off the cache; outside trading hours we settle to 30 min.
    marketOpenMs: 300_000,
    marketClosedMs: 1_800_000,
    hiddenMs: false,
    offlineMs: false,
  },
} as const satisfies Record<string, AdaptivePollingConfig>
