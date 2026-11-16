import {
  ONBOARDING_MEANINGFUL_ACTION_EVENT,
  dispatchOnboardingMeaningfulAction,
  findRoleTab,
  readStoredUserPreferences,
  resetDashboardWalkthroughPreference,
  selectOnboardingGoal,
  shouldShowDashboardWalkthrough,
} from './userPreferences'

describe('userPreferences onboarding normalization', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('normalizes legacy onboarding state and preserves valid bounded goal IDs', () => {
    window.localStorage.setItem('vnibb-user-preferences', JSON.stringify({
      onboarding: { dashboardWalkthroughVersion: 'bad', goalId: 'Follow a ticker' },
    }))

    expect(readStoredUserPreferences().onboarding).toEqual({
      dashboardWalkthroughVersion: 0,
      dashboardWalkthroughDismissedVersion: 0,
      goalId: undefined,
    })

    selectOnboardingGoal('follow_ticker')
    expect(readStoredUserPreferences().onboarding.goalId).toBe('follow_ticker')
  })

  it.each(['view_open', 'symbol_change', 'widget_add', 'prompt_submit'] as const)('keeps completion pending until %s is handled by the walkthrough', (actionId) => {
    const actionListener = jest.fn()
    window.addEventListener(ONBOARDING_MEANINGFUL_ACTION_EVENT, actionListener)

    expect(shouldShowDashboardWalkthrough()).toBe(true)
    dispatchOnboardingMeaningfulAction(actionId)
    expect(actionListener).toHaveBeenCalledTimes(1)
    expect((actionListener.mock.calls[0][0] as CustomEvent).detail).toEqual({ actionId })
    expect(shouldShowDashboardWalkthrough()).toBe(true)

    resetDashboardWalkthroughPreference()
    expect(shouldShowDashboardWalkthrough()).toBe(true)
    window.removeEventListener(ONBOARDING_MEANINGFUL_ACTION_EVENT, actionListener)
  })
})

describe('findRoleTab', () => {
  // The two layout sources the app serves (#253): the published Fundamental
  // workspace labels the tab "Fundamentals", the bundled fallback "Financials".
  const publishedTabs = [
    { id: 'tab-default-fundamental-discovery', name: 'Discovery' },
    { id: 'tab-default-fundamental-fundamentals', name: 'Fundamentals' },
    { id: 'tab-default-fundamental-overview', name: 'Overview' },
  ]
  const bundledTabs = [
    { id: 'default-fundamental-tab-0', name: 'Overview' },
    { id: 'default-fundamental-tab-1', name: 'Financials' },
  ]

  it('resolves the published Fundamentals tab as the financials role', () => {
    expect(findRoleTab(publishedTabs, 'financials')).toEqual(publishedTabs[1])
  })

  it('resolves the bundled Financials tab as the financials role', () => {
    expect(findRoleTab(bundledTabs, 'financials')).toEqual(bundledTabs[1])
  })

  it('keeps suffixed tab names in their role', () => {
    expect(findRoleTab([{ id: 'x', name: 'Fundamentals 2' }], 'financials')).toEqual({ id: 'x', name: 'Fundamentals 2' })
    expect(findRoleTab([{ id: 'y', name: 'Financials (HOSE)' }], 'financials')).toEqual({ id: 'y', name: 'Financials (HOSE)' })
  })

  it('never falls back to tab order when no tab carries the role', () => {
    expect(findRoleTab([{ id: 'only', name: 'Discovery' }], 'financials')).toBeNull()
    expect(findRoleTab([], 'financials')).toBeNull()
  })

  it('does not confuse a non-financial tab with the financials role', () => {
    const tabs = [
      { id: 'tech', name: 'Technical' },
      { id: 'quant', name: 'Quant' },
    ]
    expect(findRoleTab(tabs, 'financials')).toBeNull()
    expect(findRoleTab(tabs, 'overview')).toBeNull()
  })
})
