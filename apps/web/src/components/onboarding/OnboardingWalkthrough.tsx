'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, ArrowLeft, ArrowRight, BarChart3, Building2, Check, Search, Sparkles, X, type LucideIcon } from 'lucide-react'
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics'
import { normalizeTickerSymbol } from '@/lib/defaultTicker'
import { searchStocks } from '@/data/stockData'
import { ONBOARDING_GOALS, type OnboardingGoalId } from '@/lib/userPreferences'

type WalkthroughStep = {
  id: string
  title: string
  description: string
  /**
   * Preference-ordered targets; the first one present in the routed view is
   * highlighted. A fallback chain (not one fixed selector) is what lets the
   * same guide work against both layouts the app can serve: the published
   * Fundamental tab splits financials into separate widgets, while the bundled
   * fallback keeps the single `unified_financials` surface (#253).
   */
  targets: readonly string[]
}

type GoalPresentation = {
  icon: LucideIcon
  result: string
  detail: string
  requiresTicker: boolean
  steps: WalkthroughStep[]
  finalTitle: string
  finalDescription: string
  finalAction: string
}

interface OnboardingWalkthroughProps {
  open: boolean
  currentSymbol: string
  onSkip: () => void
  onGoalSelect: (goalId: OnboardingGoalId, symbol?: string) => boolean
  onComplete: (goalId: OnboardingGoalId, openVniAgent?: boolean) => void
  /**
   * #253: the workspace catalog has settled, so a goal can be routed for real.
   * Until then goals are shown disabled: `onGoalSelect` answers only "did this
   * route now", and the guide must never open on an unrouted goal.
   */
  workspaceReady: boolean
}

const GOAL_PRESENTATION: Record<OnboardingGoalId, GoalPresentation> = {
  follow_ticker: {
    icon: Activity,
    result: 'Ticker workspace',
    detail: 'Price trend, key metrics, profile, and recent news.',
    requiresTicker: true,
    steps: [
      {
        id: 'price-trend',
        title: 'Start with the trend',
        description: 'Use the price chart to frame direction, momentum, and the time horizon before checking individual signals.',
        targets: ['[data-widget-type="price_chart"]'],
      },
      {
        id: 'key-metrics',
        title: 'Check the essentials',
        description: 'Key metrics keep valuation and operating context beside the chart so the price move is not read in isolation.',
        targets: ['[data-widget-type="key_metrics"]'],
      },
    ],
    finalTitle: 'Your ticker view is ready',
    finalDescription: 'VniAgent will open with a technical-analysis starter prompt for the selected symbol.',
    finalAction: 'Ask VniAgent',
  },
  evaluate_company: {
    icon: Building2,
    result: 'Financial review',
    detail: 'Statements, periods, and a company-analysis prompt.',
    requiresTicker: true,
    steps: [
      {
        id: 'financial-statements',
        title: 'Read the statements together',
        description: 'Revenue, profitability, balance-sheet strength, and cash flow share one working surface for faster comparison.',
        // Published Fundamentals splits the statements across separate widgets;
        // the bundled fallback keeps `unified_financials`. First match wins, and
        // an absent target (neither layout has one) is reported, not faked.
        targets: [
          '[data-widget-type="financial_snapshot"]',
          '[data-widget-type="unified_financials"]',
          '[data-widget-type="income_statement"]',
          '[data-widget-type="financial_ratios"]',
        ],
      },
      {
        id: 'financial-tabs',
        title: 'Keep the company in context',
        description: 'Move between Financials, Overview, Ownership, and Technical views without losing the selected symbol.',
        targets: ['[data-tour="tab-bar"]'],
      },
    ],
    finalTitle: 'Your company review is ready',
    finalDescription: 'VniAgent will open with a financial-health starter prompt for the selected company.',
    finalAction: 'Analyze with VniAgent',
  },
  scan_market: {
    icon: BarChart3,
    result: 'Market Scan',
    detail: 'Breadth, heatmap, top movers, and the stock screener.',
    requiresTicker: false,
    steps: [
      {
        id: 'market-pulse',
        title: 'Read the market pulse',
        description: 'The overview summarizes index direction and participation before you narrow the scan.',
        targets: ['[data-widget-type="market_overview"]'],
      },
      {
        id: 'market-heatmap',
        title: 'Find concentrated strength',
        description: 'The heatmap makes sector leadership and broad risk-off pressure visible at a glance.',
        targets: ['[data-widget-type="market_heatmap"]'],
      },
      {
        id: 'market-movers',
        title: 'Filter the shortlist',
        description: 'Use the screener to narrow the market by exchange or other filters before reviewing a ticker.',
        targets: ['[data-widget-type="screener"]'],
      },
    ],
    finalTitle: 'Your market scan is ready',
    finalDescription: 'The workspace is saved and ready for filtering, comparison, or a deeper ticker review.',
    finalAction: 'Explore the market',
  },
}

const VIEWPORT_PADDING = 16
const GUIDE_PANEL_WIDTH = 360
const CHOICE_PANEL_WIDTH = 560
const HIGHLIGHT_PADDING = 10
const PANEL_ESTIMATED_HEIGHT = 380

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function OnboardingWalkthrough({ open, currentSymbol, onSkip, onGoalSelect, onComplete, workspaceReady }: OnboardingWalkthroughProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [stage, setStage] = useState<'goal' | 'ticker' | 'guide'>('goal')
  const [selectedGoal, setSelectedGoal] = useState<OnboardingGoalId | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [tickerInput, setTickerInput] = useState('')
  const [routeError, setRouteError] = useState('')
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const currentSymbolRef = useRef(currentSymbol)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    currentSymbolRef.current = currentSymbol
  }, [currentSymbol])

  useEffect(() => {
    if (!open) {
      setTargetRect(null)
      return
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setStage('goal')
    setSelectedGoal(null)
    setStepIndex(0)
    setTickerInput(currentSymbolRef.current)
    setRouteError('')
  }, [open])

  const presentation = selectedGoal ? GOAL_PRESENTATION[selectedGoal] : null
  const guidanceSteps = presentation?.steps ?? []
  const isFinalStep = stage === 'guide' && stepIndex >= guidanceSteps.length
  const currentStep = stage === 'guide' && !isFinalStep ? guidanceSteps[stepIndex] : null
  const suggestions = useMemo(() => searchStocks(tickerInput, 6), [tickerInput])

  const routeGoal = (goalId: OnboardingGoalId, symbol?: string) => {
    // Belt and braces: the buttons are disabled until ready, but routing must
    // never be attempted against a catalog that has not settled.
    if (!workspaceReady) return
    const routed = onGoalSelect(goalId, symbol)
    if (!routed) {
      setRouteError('This view is unavailable right now. Close the walkthrough and try again.')
      return
    }

    setSelectedGoal(goalId)
    setStage('guide')
    setStepIndex(0)
    setRouteError('')
  }

  const chooseGoal = (goalId: OnboardingGoalId) => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingGoalSelected, { goal_id: goalId })
    setSelectedGoal(goalId)
    setRouteError('')

    if (GOAL_PRESENTATION[goalId].requiresTicker) {
      setStage('ticker')
      return
    }

    routeGoal(goalId)
  }

  const submitTicker = () => {
    if (!selectedGoal) return
    const normalized = normalizeTickerSymbol(tickerInput)
    if (!normalized) {
      setRouteError('Enter a valid three-character Vietnam ticker, such as FPT or VNM.')
      return
    }
    setTickerInput(normalized)
    routeGoal(selectedGoal, normalized)
  }

  useEffect(() => {
    if (!open || stage !== 'guide') return

    captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingWalkthroughStepViewed, {
      step_id: isFinalStep ? 'done' : currentStep?.id,
      step_index: stepIndex,
      goal_id: selectedGoal,
    })
  }, [currentStep?.id, isFinalStep, open, selectedGoal, stage, stepIndex])

  const targetKey = currentStep?.targets.join('|') ?? ''

  useEffect(() => {
    if (!open || !targetKey || typeof window === 'undefined') {
      setTargetRect(null)
      setTargetMissing(false)
      return
    }

    let target: HTMLElement | null = null
    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let giveUpTimer: number | undefined

    const updateRect = () => {
      if (target) setTargetRect(target.getBoundingClientRect())
    }
    const scheduleUpdate = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(updateRect)
    }
    const bindTarget = () => {
      if (target) return true
      const selectors = targetKey.split('|')
      for (const selector of selectors) {
        const match = document.querySelector<HTMLElement>(selector)
        if (match) {
          target = match
          break
        }
      }
      if (!target) return false
      window.clearTimeout(giveUpTimer)
      setTargetMissing(false)
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate)
      resizeObserver?.observe(target)
      scheduleUpdate()
      mutationObserver?.disconnect()
      return true
    }

    setTargetRect(null)
    setTargetMissing(false)
    if (!bindTarget()) {
      mutationObserver = new MutationObserver(bindTarget)
      mutationObserver.observe(document.body, { childList: true, subtree: true })
      // A guide step whose widgets are absent from this layout (a reduced
      // custom template, or a widget that failed to mount) must say so instead
      // of silently showing an unanchored panel. The walkthrough stays usable:
      // this is a notice, not a dead end.
      giveUpTimer = window.setTimeout(() => {
        if (target) return
        mutationObserver?.disconnect()
        setTargetMissing(true)
      }, 2500)
    }
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    return () => {
      window.clearTimeout(giveUpTimer)
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [open, targetKey])

  const closeAndRestoreFocus = () => {
    onSkip()
    window.requestAnimationFrame(() => openerRef.current?.focus())
  }

  const finish = (openVniAgent = false) => {
    if (!selectedGoal) return
    onComplete(selectedGoal, openVniAgent)
    if (!openVniAgent) window.requestAnimationFrame(() => openerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return

    const focusInitialControl = () => {
      dialogRef.current?.querySelector<HTMLElement>('[data-walkthrough-initial-focus="true"]')?.focus()
    }
    const timeoutId = window.setTimeout(focusInitialControl, 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (stage === 'guide') finish()
        else closeAndRestoreFocus()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, selectedGoal, stage])

  const highlightStyle = useMemo(() => {
    if (!open || !targetRect || typeof window === 'undefined') return null
    const top = clamp(targetRect.top - HIGHLIGHT_PADDING, VIEWPORT_PADDING, window.innerHeight)
    const left = clamp(targetRect.left - HIGHLIGHT_PADDING, VIEWPORT_PADDING, window.innerWidth)
    const maxWidth = Math.max(0, window.innerWidth - left - VIEWPORT_PADDING)
    const maxHeight = Math.max(0, window.innerHeight - top - VIEWPORT_PADDING)
    return {
      top,
      left,
      width: Math.min(targetRect.width + HIGHLIGHT_PADDING * 2, maxWidth),
      height: Math.min(targetRect.height + HIGHLIGHT_PADDING * 2, maxHeight),
    }
  }, [open, targetRect])

  const panelStyle = useMemo(() => {
    if (typeof window === 'undefined') return { left: VIEWPORT_PADDING, top: VIEWPORT_PADDING, width: CHOICE_PANEL_WIDTH }
    const requestedWidth = stage === 'guide' ? GUIDE_PANEL_WIDTH : CHOICE_PANEL_WIDTH
    const width = Math.min(requestedWidth, window.innerWidth - VIEWPORT_PADDING * 2)
    if (!highlightStyle) {
      return {
        left: Math.max(VIEWPORT_PADDING, (window.innerWidth - width) / 2),
        top: Math.max(VIEWPORT_PADDING, (window.innerHeight - PANEL_ESTIMATED_HEIGHT) / 2),
        width,
      }
    }
    const spaceBelow = window.innerHeight - (highlightStyle.top + highlightStyle.height)
    const top = spaceBelow >= PANEL_ESTIMATED_HEIGHT || highlightStyle.top < PANEL_ESTIMATED_HEIGHT
      ? clamp(highlightStyle.top + highlightStyle.height + VIEWPORT_PADDING, VIEWPORT_PADDING, window.innerHeight - PANEL_ESTIMATED_HEIGHT - VIEWPORT_PADDING)
      : clamp(highlightStyle.top - PANEL_ESTIMATED_HEIGHT - VIEWPORT_PADDING, VIEWPORT_PADDING, window.innerHeight - PANEL_ESTIMATED_HEIGHT - VIEWPORT_PADDING)
    const left = clamp(highlightStyle.left, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
    return { left, top, width }
  }, [highlightStyle, stage])

  if (!isMounted || !open) return null

  const progressLabel = stage === 'guide'
    ? isFinalStep ? 'Ready' : `${stepIndex + 1} of ${guidanceSteps.length}`
    : stage === 'ticker' ? 'Choose ticker' : 'Choose outcome'
  const title = stage === 'goal'
    ? 'Start with an outcome'
    : stage === 'ticker'
      ? `Choose a company for ${presentation?.result.toLowerCase()}`
      : isFinalStep
        ? presentation?.finalTitle
        : currentStep?.title
  const description = stage === 'goal'
    ? 'VniBB will open the working view first, then show the two or three controls that matter for that workflow.'
    : stage === 'ticker'
      ? 'Search a popular Vietnam stock or enter its three-character symbol.'
      : isFinalStep
        ? presentation?.finalDescription
        : currentStep?.description

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[140]">
      <div className={highlightStyle ? 'pointer-events-auto fixed inset-0' : 'pointer-events-auto fixed inset-0 bg-[rgb(2_6_23_/_0.76)]'} />
      {highlightStyle ? <div aria-hidden="true" className="pointer-events-none fixed rounded-md border-2 border-[var(--focus-ring-color)] bg-transparent shadow-[0_0_0_9999px_rgb(2_6_23_/_0.74)] transition-all duration-300" style={highlightStyle} /> : null}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="VniBB walkthrough" className="pointer-events-auto fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 text-left text-[var(--text-primary)] shadow-lg animate-in fade-in zoom-in-95 duration-200" style={panelStyle}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              <Sparkles size={12} />
              VniBB quick start
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
          </div>
          <button type="button" onClick={stage === 'guide' ? () => finish() : closeAndRestoreFocus} className="min-h-9 min-w-9 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Close walkthrough">
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 max-w-[48ch] text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        {stage === 'guide' && !isFinalStep && targetMissing ? (
          <p role="status" className="mt-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">
            This layout does not include the widget for this step, so there is nothing to highlight. Continue to keep the tour going.
          </p>
        ) : null}

        {stage === 'goal' ? (
          <div className="mt-5 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {!workspaceReady ? (
              <p role="status" className="py-3 text-xs font-medium text-[var(--text-muted)]">
                Preparing your workspace…
              </p>
            ) : null}
            {ONBOARDING_GOALS.map((goal, index) => {
              const goalPresentation = GOAL_PRESENTATION[goal.id]
              const Icon = goalPresentation.icon
              return (
                <button key={goal.id} type="button" disabled={!workspaceReady} data-walkthrough-initial-focus={index === 0 ? 'true' : undefined} onClick={() => chooseGoal(goal.id)} className="group grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 py-4 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent">
                  <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors group-hover:border-[var(--border-strong)] group-hover:text-[var(--text-primary)]"><Icon size={18} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{goal.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{goalPresentation.detail}</span>
                  </span>
                  <ArrowRight size={16} className="text-[var(--text-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-accent-primary)]" />
                </button>
              )
            })}
          </div>
        ) : null}

        {stage === 'ticker' ? (
          <form className="mt-5" onSubmit={(event) => { event.preventDefault(); submitTicker() }}>
            <label htmlFor="walkthrough-ticker" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Vietnam ticker</label>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 focus-within:ring-2 focus-within:ring-[var(--focus-ring-color)]">
              <Search size={16} className="text-[var(--text-muted)]" />
              <input id="walkthrough-ticker" data-walkthrough-initial-focus="true" value={tickerInput} onChange={(event) => { setTickerInput(event.target.value.toUpperCase()); setRouteError('') }} autoComplete="off" className="min-h-12 w-full bg-transparent text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)] outline-none placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--text-muted)]" placeholder="Search FPT, VNM, MBB..." />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {suggestions.map((stock) => (
                <button key={stock.symbol} type="button" onClick={() => { setTickerInput(stock.symbol); setRouteError('') }} className={tickerInput === stock.symbol ? 'rounded-md border border-[var(--color-accent-primary)] bg-[var(--color-state-bg)] px-3 py-2 text-left' : 'rounded-md border border-[var(--border-default)] px-3 py-2 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'}>
                  <span className="block text-xs font-bold text-[var(--text-primary)]">{stock.symbol}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{stock.name}</span>
                </button>
              ))}
            </div>
            {routeError ? <p role="alert" className="mt-3 text-xs font-medium text-[var(--color-warning)]">{routeError}</p> : null}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => { setStage('goal'); setSelectedGoal(null); setRouteError('') }} className="inline-flex min-h-10 items-center gap-1.5 px-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={14} />Back</button>
              <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--color-accent-fill)] px-4 py-2 text-xs font-bold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]">Open {presentation?.result}<ArrowRight size={14} /></button>
            </div>
          </form>
        ) : null}

        {stage === 'goal' && routeError ? <p role="alert" className="mt-3 text-xs font-medium text-[var(--color-warning)]">{routeError}</p> : null}

        {stage === 'guide' ? (
          <>
            <div className="mt-5 flex items-center gap-1.5">
              {guidanceSteps.map((step, index) => <span key={step.id} className={index === stepIndex ? 'h-1.5 flex-1 rounded-full bg-[var(--color-accent-primary)]' : index < stepIndex || isFinalStep ? 'h-1.5 flex-1 rounded-full bg-[var(--color-accent-secondary)]' : 'h-1.5 flex-1 rounded-full bg-[var(--bg-tertiary)]'} />)}
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{progressLabel}</span>
            </div>
            {isFinalStep ? (
              <div className="mt-5 flex items-center gap-3 border-y border-[var(--border-subtle)] py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-state-border)] bg-[var(--color-state-bg)] text-[var(--color-info)]"><Check size={18} /></span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Outcome opened</p>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">You can restart this guide from Settings.</p>
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => finish()} className="min-h-9 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">Exit tour</button>
              <div className="flex items-center gap-2">
                {!isFinalStep && stepIndex > 0 ? <button type="button" onClick={() => setStepIndex((current) => current - 1)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[var(--border-strong)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"><ArrowLeft size={14} />Back</button> : null}
                <button type="button" data-walkthrough-initial-focus="true" onClick={() => isFinalStep ? finish(selectedGoal !== 'scan_market') : setStepIndex((current) => current + 1)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent-fill)] px-3 py-2 text-xs font-bold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]">
                  {isFinalStep ? <><Check size={14} />{presentation?.finalAction}</> : <>Next<ArrowRight size={14} /></>}
                </button>
              </div>
            </div>
          </>
        ) : stage === 'goal' ? (
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={closeAndRestoreFocus} className="min-h-9 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">Skip for now</button>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{progressLabel}</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
