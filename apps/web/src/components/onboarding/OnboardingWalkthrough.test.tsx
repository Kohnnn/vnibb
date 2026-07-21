import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'

import { OnboardingWalkthrough } from './OnboardingWalkthrough'
import { captureAnalyticsEvent } from '@/lib/analytics'
import { dispatchOnboardingMeaningfulAction } from '@/lib/userPreferences'

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: { onboardingGoalSelected: 'goal_selected', onboardingWalkthroughStepViewed: 'step_viewed' },
  captureAnalyticsEvent: jest.fn(),
}))

describe('OnboardingWalkthrough', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    })
  })

  it.each([
    ['Follow a ticker', 'follow_ticker'],
    ['Evaluate a company', 'evaluate_company'],
    ['Scan the market', 'scan_market'],
  ] as const)('routes %s without completing onboarding', async (label, goalId) => {
    const user = userEvent.setup()
    const onGoalSelect = jest.fn()
    const onSkip = jest.fn()

    render(<OnboardingWalkthrough open onSkip={onSkip} onGoalSelect={onGoalSelect} onMeaningfulAction={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: new RegExp(label) }))

    expect(onGoalSelect).toHaveBeenCalledWith(goalId)
    expect(captureAnalyticsEvent).toHaveBeenCalledWith('goal_selected', { goal_id: goalId })
    expect(onSkip).not.toHaveBeenCalled()
  })

  it.each(['view_open', 'symbol_change', 'widget_add', 'prompt_submit'] as const)('completes only after %s', (actionId) => {
    const onMeaningfulAction = jest.fn()
    render(<OnboardingWalkthrough open onSkip={jest.fn()} onGoalSelect={jest.fn()} onMeaningfulAction={onMeaningfulAction} />)

    dispatchOnboardingMeaningfulAction(actionId)

    expect(onMeaningfulAction).toHaveBeenCalledWith(actionId)
  })

  it('closes on Escape and restores opener focus', async () => {
    const onSkip = jest.fn()
    const opener = document.createElement('button')
    opener.textContent = 'Open walkthrough'
    document.body.appendChild(opener)
    opener.focus()

    function TestWalkthrough() {
      const [open, setOpen] = useState(true)
      return <OnboardingWalkthrough open={open} onSkip={() => { onSkip(); setOpen(false) }} onGoalSelect={jest.fn()} onMeaningfulAction={jest.fn()} />
    }

    render(<TestWalkthrough />)

    const dialog = screen.getByRole('dialog', { name: 'VNIBB walkthrough' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Follow a ticker/ })).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(onSkip).toHaveBeenCalledTimes(1)
    document.body.removeChild(opener)
  })
})
