'use client'

import { focusManager, onlineManager } from '@tanstack/react-query'

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'
const MARKET_OPEN_MINUTES = [
  { start: 9 * 60, end: 11 * 60 + 30 },
  { start: 13 * 60, end: 14 * 60 + 45 },
] as const
const POST_CLOSE_START_MINUTES = 14 * 60 + 45
const POST_CLOSE_END_MINUTES = 15 * 60

export type VietnamMarketPhase = 'active' | 'post-close' | 'closed'

export interface AdaptivePollingConfig {
  marketOpenMs: number
  marketClosedMs: number
  postCloseMs?: number
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

export function getVietnamMarketPhase(date: Date = new Date()): VietnamMarketPhase {
  const { weekday, hour, minute } = getVietnamClock(date)

  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'closed'
  }

  const totalMinutes = hour * 60 + minute
  if (MARKET_OPEN_MINUTES.some((window) => totalMinutes >= window.start && totalMinutes < window.end)) {
    return 'active'
  }
  if (totalMinutes >= POST_CLOSE_START_MINUTES && totalMinutes < POST_CLOSE_END_MINUTES) {
    return 'post-close'
  }
  return 'closed'
}

export function isVietnamMarketOpen(date: Date = new Date()): boolean {
  return getVietnamMarketPhase(date) === 'active'
}

export function getAdaptiveRefetchInterval(
  config: AdaptivePollingConfig,
  at: Date = new Date(),
): number | false {
  if (!onlineManager.isOnline()) {
    return config.offlineMs ?? false
  }

  const phase = getVietnamMarketPhase(at)
  const interval = phase === 'active'
    ? config.marketOpenMs
    : phase === 'post-close'
      ? config.postCloseMs ?? config.marketClosedMs
      : config.marketClosedMs

  if (!focusManager.isFocused()) {
    return config.hiddenMs ?? false
  }

  return interval
}

export const POLLING_PRESETS = {
  marketOverview: {
    marketOpenMs: 20_000,
    marketClosedMs: 180_000,
    postCloseMs: 60_000,
    hiddenMs: false,
    offlineMs: false,
  },
  priceBoard: {
    marketOpenMs: 15_000,
    marketClosedMs: 300_000,
    postCloseMs: 60_000,
    hiddenMs: false,
    offlineMs: false,
  },
  quotes: {
    marketOpenMs: 30_000,
    marketClosedMs: 300_000,
    postCloseMs: 90_000,
    hiddenMs: false,
    offlineMs: false,
  },
  movers: {
    marketOpenMs: 60_000,
    marketClosedMs: 300_000,
    postCloseMs: 120_000,
    hiddenMs: false,
    offlineMs: false,
  },
  alerts: {
    marketOpenMs: 30_000,
    marketClosedMs: 180_000,
    postCloseMs: 90_000,
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
    postCloseMs: 600_000,
    hiddenMs: false,
    offlineMs: false,
  },
} as const satisfies Record<string, AdaptivePollingConfig>
