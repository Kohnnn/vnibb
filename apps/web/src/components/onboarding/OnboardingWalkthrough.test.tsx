import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'

import { OnboardingWalkthrough } from './OnboardingWalkthrough'
import { captureAnalyticsEvent } from '@/lib/analytics'

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: { onboardingGoalSelected: 'goal_selected', onboardingWalkthroughStepViewed: 'step_viewed' },
  captureAnalyticsEvent: jest.fn(),
}))

const defaultProps = {
  open: true,
  currentSymbol: 'VCI',
  onSkip: jest.fn(),
  onGoalSelect: jest.fn(() => true),
  onComplete: jest.fn(),
  workspaceReady: true,
}

describe('OnboardingWalkthrough', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['Follow a ticker', 'follow_ticker'],
    ['Evaluate a company', 'evaluate_company'],
  ] as const)('captures a ticker before routing %s', async (label, goalId) => {
    const user = userEvent.setup()
    const onGoalSelect = jest.fn(() => true)

    render(<OnboardingWalkthrough {...defaultProps} onGoalSelect={onGoalSelect} />)

    await user.click(screen.getByRole('button', { name: new RegExp(label) }))
    expect(onGoalSelect).not.toHaveBeenCalled()

    const tickerInput = screen.getByRole('textbox', { name: 'Vietnam ticker' })
    await user.clear(tickerInput)
    await user.type(tickerInput, 'fpt')
    await user.click(screen.getByRole('button', { name: /^Open / }))

    expect(onGoalSelect).toHaveBeenCalledWith(goalId, 'FPT')
    expect(captureAnalyticsEvent).toHaveBeenCalledWith('goal_selected', { goal_id: goalId })
  })

  it('routes market scan without requesting a ticker', async () => {
    const user = userEvent.setup()
    const onGoalSelect = jest.fn(() => true)

    render(<OnboardingWalkthrough {...defaultProps} onGoalSelect={onGoalSelect} />)
    await user.click(screen.getByRole('button', { name: /Scan the market/ }))

    expect(onGoalSelect).toHaveBeenCalledWith('scan_market', undefined)
    expect(screen.getByText('Read the market pulse')).toBeInTheDocument()
  })

  it('keeps the chooser open when a requested view cannot be routed', async () => {
    const user = userEvent.setup()
    render(<OnboardingWalkthrough {...defaultProps} onGoalSelect={() => false} />)

    await user.click(screen.getByRole('button', { name: /Scan the market/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('This view is unavailable right now')
    expect(screen.getByText('Start with an outcome')).toBeInTheDocument()
  })

  it('validates a ticker before routing', async () => {
    const user = userEvent.setup()
    const onGoalSelect = jest.fn(() => true)
    render(<OnboardingWalkthrough {...defaultProps} onGoalSelect={onGoalSelect} />)

    await user.click(screen.getByRole('button', { name: /Follow a ticker/ }))
    const tickerInput = screen.getByRole('textbox', { name: 'Vietnam ticker' })
    await user.clear(tickerInput)
    await user.type(tickerInput, 'ab')
    await user.click(screen.getByRole('button', { name: /^Open / }))

    expect(onGoalSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('valid three-character Vietnam ticker')
  })

  it('guides through the routed outcome before completing', async () => {
    const user = userEvent.setup()
    const onComplete = jest.fn()
    const marketOverview = document.createElement('div')
    marketOverview.dataset.widgetType = 'market_overview'
    const marketHeatmap = document.createElement('div')
    marketHeatmap.dataset.widgetType = 'market_heatmap'
    const topMovers = document.createElement('div')
    topMovers.dataset.widgetType = 'top_movers'
    document.body.append(marketOverview, marketHeatmap, topMovers)

    render(<OnboardingWalkthrough {...defaultProps} onComplete={onComplete} />)
    await user.click(screen.getByRole('button', { name: /Scan the market/ }))
    expect(onComplete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Find concentrated strength')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Open the shortlist')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Your market scan is ready')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Explore the market' }))

    expect(onComplete).toHaveBeenCalledWith('scan_market', false)
    marketOverview.remove()
    marketHeatmap.remove()
    topMovers.remove()
  })

  it('closes on Escape and restores opener focus before routing', async () => {
    const onSkip = jest.fn()
    const opener = document.createElement('button')
    opener.textContent = 'Open walkthrough'
    document.body.appendChild(opener)
    opener.focus()

    function TestWalkthrough() {
      const [open, setOpen] = useState(true)
      return <OnboardingWalkthrough {...defaultProps} open={open} onSkip={() => { onSkip(); setOpen(false) }} />
    }

    render(<TestWalkthrough />)

    const dialog = screen.getByRole('dialog', { name: 'VniBB walkthrough' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Follow a ticker/ })).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(onSkip).toHaveBeenCalledTimes(1)
    opener.remove()
  })

  it('restores opener focus when exiting routed guidance', async () => {
    const user = userEvent.setup()
    const onComplete = jest.fn()
    const opener = document.createElement('button')
    opener.textContent = 'Open walkthrough'
    document.body.appendChild(opener)
    opener.focus()

    function TestWalkthrough() {
      const [open, setOpen] = useState(true)
      return <OnboardingWalkthrough {...defaultProps} open={open} onComplete={(goalId, openVniAgent) => { onComplete(goalId, openVniAgent); setOpen(false) }} />
    }

    render(<TestWalkthrough />)
    await user.click(screen.getByRole('button', { name: /Follow a ticker/ }))
    await user.click(screen.getByRole('button', { name: 'Open Ticker workspace' }))
    await user.click(screen.getByRole('button', { name: 'Exit tour' }))

    await waitFor(() => expect(opener).toHaveFocus())
    expect(onComplete).toHaveBeenCalledWith('follow_ticker', false)
    opener.remove()
  })


  /**
   * #253 guide targets. Evaluate-a-company used to highlight exactly
   * `unified_financials`; the published Fundamental layout has no such widget,
   * so the guide had nothing to point at even once routing was fixed. The step
   * now accepts whichever financial surface the routed layout really contains,
   * and says so when a reduced layout contains none.
   */
  it.each([
    ['published Fundamentals', 'financial_snapshot'],
    ['bundled fallback', 'unified_financials'],
    ['statement-only layout', 'income_statement'],
  ])('highlights the financial surface present in the %s layout', async (_label, widgetType) => {
    const user = userEvent.setup()
    const surface = document.createElement('div')
    surface.dataset.widgetType = widgetType
    document.body.append(surface)

    render(<OnboardingWalkthrough {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /Evaluate a company/ }))
    await user.click(screen.getByRole('button', { name: /^Open / }))

    expect(screen.getByText('Read the statements together')).toBeInTheDocument()
    expect(screen.queryByText(/does not include the widget for this step/)).not.toBeInTheDocument()
    surface.remove()
  })

  it('says a step has nothing to highlight when the routed layout omits that widget', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })

    render(<OnboardingWalkthrough {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /Evaluate a company/ }))
    await user.click(screen.getByRole('button', { name: /^Open / }))

    expect(screen.queryByText(/does not include the widget for this step/)).not.toBeInTheDocument()
    await act(async () => { jest.advanceTimersByTime(2600) })

    expect(screen.getByRole('status')).toHaveTextContent('does not include the widget for this step')
    // The tour stays usable: the notice is not a dead end.
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    jest.useRealTimers()
  })

  // #253 review: the guide must never open on a goal that did not actually
  // route, and the walkthrough must not offer a goal until the workspace
  // catalog has settled.
  describe('workspace readiness', () => {
    it('shows a pending state and disabled goals until the workspace is ready', () => {
      const onGoalSelect = jest.fn(() => true)
      render(<OnboardingWalkthrough {...defaultProps} workspaceReady={false} onGoalSelect={onGoalSelect} />)

      expect(screen.getByRole('status')).toHaveTextContent('Preparing your workspace')
      const evaluate = screen.getByRole('button', { name: /Evaluate a company/ })
      expect(evaluate).toBeDisabled()
      fireEvent.click(evaluate)
      expect(onGoalSelect).not.toHaveBeenCalled()
    })

    it('enables the goals and routes once the workspace is ready', async () => {
      const user = userEvent.setup()
      const onGoalSelect = jest.fn(() => true)
      const { rerender } = render(<OnboardingWalkthrough {...defaultProps} workspaceReady={false} onGoalSelect={onGoalSelect} />)

      rerender(<OnboardingWalkthrough {...defaultProps} workspaceReady onGoalSelect={onGoalSelect} />)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Evaluate a company/ }))
      await user.click(screen.getByRole('button', { name: /^Open / }))
      expect(onGoalSelect).toHaveBeenCalledWith('evaluate_company', 'VCI')
    })

    it('does not open the guide when the workspace is ready but the view is missing', async () => {
      const user = userEvent.setup()
      const onGoalSelect = jest.fn(() => false)
      render(<OnboardingWalkthrough {...defaultProps} onGoalSelect={onGoalSelect} />)

      await user.click(screen.getByRole('button', { name: /Evaluate a company/ }))
      await user.click(screen.getByRole('button', { name: /^Open / }))

      expect(screen.getByRole('alert')).toHaveTextContent('This view is unavailable right now')
      // Failed routing must not advance to the guide.
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    })

    it('does not route a goal the user skipped before the workspace loaded', async () => {
      const user = userEvent.setup()
      const onGoalSelect = jest.fn(() => true)
      render(<OnboardingWalkthrough {...defaultProps} workspaceReady={false} onGoalSelect={onGoalSelect} />)

      await user.click(screen.getByRole('button', { name: /Skip/ }))
      expect(defaultProps.onSkip).toHaveBeenCalled()
      expect(onGoalSelect).not.toHaveBeenCalled()
    })
  })
})
