import { DEFAULT_TICKER, normalizeTickerSymbol, writeStoredTicker } from '@/lib/defaultTicker'

export const USER_PREFERENCES_STORAGE_KEY = 'vnibb-user-preferences'
export const DASHBOARD_WALKTHROUGH_VERSION = 1
export const DASHBOARD_WALKTHROUGH_RESTART_EVENT = 'vnibb:restart-dashboard-walkthrough'

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
  onboarding: DashboardOnboardingPreference
}

export interface DashboardOnboardingPreference {
  dashboardWalkthroughVersion: number
}

type UserPreferencesUpdate = Partial<Omit<UserPreferences, 'onboarding'>> & {
  onboarding?: Partial<DashboardOnboardingPreference>
}

export const DEFAULT_TAB: DefaultTabPreference = 'fundamentals'

export const DEFAULT_TAB_OPTIONS: Array<{ value: DefaultTabPreference; label: string }> = [
  { value: 'fundamentals', label: 'Fundamentals' },
  { value: 'technical', label: 'Technical' },
  { value: 'quant', label: 'Quant' },
  { value: 'trading', label: 'Trading' },
  { value: 'market', label: 'Market' },
  { value: 'overview', label: 'Overview' },
  { value: 'equity-analysis', label: 'Equity Analysis' },
  { value: 'comparison', label: 'Comparison' },
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

function normalizeWalkthroughVersion(rawValue: unknown): number {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.floor(parsed)
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
    onboarding: {
      dashboardWalkthroughVersion: normalizeWalkthroughVersion(
        raw.onboarding && typeof raw.onboarding === 'object'
          ? raw.onboarding.dashboardWalkthroughVersion
          : undefined
      ),
    },
  }
}

export function writeStoredUserPreferences(next: UserPreferencesUpdate): UserPreferences {
  const current = readStoredUserPreferences()
  const resolved: UserPreferences = {
    defaultTicker: normalizeTickerSymbol(next.defaultTicker) || current.defaultTicker || DEFAULT_TICKER,
    defaultTab: normalizeTabKey(next.defaultTab) || current.defaultTab || DEFAULT_TAB,
    onboarding: {
      dashboardWalkthroughVersion: normalizeWalkthroughVersion(
        next.onboarding?.dashboardWalkthroughVersion ?? current.onboarding.dashboardWalkthroughVersion
      ),
    },
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(resolved))
  }

  writeStoredTicker(resolved.defaultTicker)
  return resolved
}

export function shouldShowDashboardWalkthrough(version = DASHBOARD_WALKTHROUGH_VERSION): boolean {
  return readStoredUserPreferences().onboarding.dashboardWalkthroughVersion < version
}

export function markDashboardWalkthroughCompleted(
  version = DASHBOARD_WALKTHROUGH_VERSION
): UserPreferences {
  return writeStoredUserPreferences({
    onboarding: {
      dashboardWalkthroughVersion: version,
    },
  })
}

export function resetDashboardWalkthroughPreference(): UserPreferences {
  return writeStoredUserPreferences({
    onboarding: {
      dashboardWalkthroughVersion: 0,
    },
  })
}

export function requestDashboardWalkthroughRestart(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(DASHBOARD_WALKTHROUGH_RESTART_EVENT))
}

export function findPreferredTabId<T extends { id: string; name: string }>(
  tabs: T[],
  preferredTab?: DefaultTabPreference
): string | null {
  const resolvedPreference = normalizeTabKey(preferredTab) || readStoredUserPreferences().defaultTab
  const preferredTabMatch = tabs.find((tab) => normalizeTabKey(tab.name) === resolvedPreference)
  return preferredTabMatch?.id || null
}

export function findPreferredDashboardId<T extends { id: string; name: string; tabs?: Array<{ name: string }> }>(
  dashboards: T[],
  preferredTab?: DefaultTabPreference
): string | null {
  const resolvedPreference = normalizeTabKey(preferredTab) || readStoredUserPreferences().defaultTab
  const preferredDashboardMatch = dashboards.find(
    (dashboard) => normalizeTabKey(dashboard.name) === resolvedPreference
  )
  if (preferredDashboardMatch?.id) return preferredDashboardMatch.id

  const fallbackByTabMatch = dashboards.find((dashboard) =>
    (dashboard.tabs || []).some((tab) => normalizeTabKey(tab.name) === resolvedPreference)
  )

  return fallbackByTabMatch?.id || null
}
