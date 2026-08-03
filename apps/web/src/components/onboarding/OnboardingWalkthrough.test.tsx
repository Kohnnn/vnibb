import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    const dialog = screen.getByRole('dialog', { name: 'VNIBB walkthrough' })
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
})
