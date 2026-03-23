import { DEFAULT_TICKER, normalizeTickerSymbol, writeStoredTicker } from '@/lib/defaultTicker'

export const USER_PREFERENCES_STORAGE_KEY = 'vnibb-user-preferences'

export type DefaultTabPreference =
  | 'overview'
  | 'equity-analysis'
  | 'quant'
  | 'technical'
  | 'trading'
  | 'comparison'
  | 'fundamentals'
  | 'market'
  | 'news-events'

export interface UserPreferences {
  defaultTicker: string
  defaultTab: DefaultTabPreference
}

export const DEFAULT_TAB: DefaultTabPreference = 'overview'

export const DEFAULT_TAB_OPTIONS: Array<{ value: DefaultTabPreference; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'equity-analysis', label: 'Equity Analysis' },
  { value: 'quant', label: 'Quant' },
  { value: 'technical', label: 'Technical' },
  { value: 'trading', label: 'Trading' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'fundamentals', label: 'Fundamentals' },
  { value: 'market', label: 'Market' },
  { value: 'news-events', label: 'News & Events' },
]

function normalizeTabKey(rawValue: string | null | undefined): DefaultTabPreference | null {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  switch (normalized) {
    case 'overview':
      return 'overview'
    case 'equity-analysis':
    case 'equity':
    case 'analysis':
    case 'deep-dive':
      return 'equity-analysis'
    case 'quant-technical':
    case 'quant-and-technical':
    case 'quant':
      return 'quant'
    case 'technical':
      return 'technical'
    case 'trading':
    case 'trade':
      return 'trading'
    case 'comparison':
      return 'comparison'
    case 'fundamentals':
    case 'fundamental':
      return 'fundamentals'
    case 'market':
    case 'market-analysis':
    case 'macro':
      return 'market'
    case 'news-events':
    case 'news-and-events':
    case 'news':
    case 'events':
      return 'news-events'
    default:
      return null
  }
}

function readRawPreferences(): Partial<UserPreferences> {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readStoredUserPreferences(): UserPreferences {
  const raw = readRawPreferences()
  return {
    defaultTicker: normalizeTickerSymbol(raw.defaultTicker) || DEFAULT_TICKER,
    defaultTab: normalizeTabKey(raw.defaultTab) || DEFAULT_TAB,
  }
}

export function writeStoredUserPreferences(next: Partial<UserPreferences>): UserPreferences {
  const current = readStoredUserPreferences()
  const resolved: UserPreferences = {
    defaultTicker: normalizeTickerSymbol(next.defaultTicker) || current.defaultTicker || DEFAULT_TICKER,
    defaultTab: normalizeTabKey(next.defaultTab) || current.defaultTab || DEFAULT_TAB,
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(resolved))
  }

  writeStoredTicker(resolved.defaultTicker)
  return resolved
}

export function findPreferredTabId<T extends { id: string; name: string }>(
  tabs: T[],
  preferredTab?: DefaultTabPreference
): string | null {
  const resolvedPreference = normalizeTabKey(preferredTab) || readStoredUserPreferences().defaultTab
  const preferredTabMatch = tabs.find((tab) => normalizeTabKey(tab.name) === resolvedPreference)
  return preferredTabMatch?.id || null
}
