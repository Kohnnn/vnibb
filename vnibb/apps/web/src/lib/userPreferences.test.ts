import {
  DASHBOARD_WALKTHROUGH_VERSION,
  USER_PREFERENCES_STORAGE_KEY,
  markDashboardWalkthroughCompleted,
  readStoredUserPreferences,
  resetDashboardWalkthroughPreference,
  shouldShowDashboardWalkthrough,
  writeStoredUserPreferences,
} from '@/lib/userPreferences'

describe('userPreferences onboarding helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('defaults walkthrough state to incomplete', () => {
    expect(readStoredUserPreferences().onboarding.dashboardWalkthroughVersion).toBe(0)
    expect(shouldShowDashboardWalkthrough()).toBe(true)
  })

  test('marks walkthrough complete and preserves it across preference updates', () => {
    markDashboardWalkthroughCompleted()
    writeStoredUserPreferences({ defaultTicker: 'VCI', defaultTab: 'technical' })

    const stored = readStoredUserPreferences()

    expect(stored.defaultTicker).toBe('VCI')
    expect(stored.defaultTab).toBe('technical')
    expect(stored.onboarding.dashboardWalkthroughVersion).toBe(DASHBOARD_WALKTHROUGH_VERSION)
    expect(shouldShowDashboardWalkthrough()).toBe(false)
  })

  test('resets walkthrough state for a replay', () => {
    markDashboardWalkthroughCompleted()
    resetDashboardWalkthroughPreference()

    const rawStored = JSON.parse(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) || '{}')

    expect(rawStored.onboarding.dashboardWalkthroughVersion).toBe(0)
    expect(shouldShowDashboardWalkthrough()).toBe(true)
  })
})
