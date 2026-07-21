import {
  ONBOARDING_MEANINGFUL_ACTION_EVENT,
  dispatchOnboardingMeaningfulAction,
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
