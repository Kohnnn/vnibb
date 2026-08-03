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
  selector?: string
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
        selector: '[data-widget-type="price_chart"]',
      },
      {
        id: 'key-metrics',
        title: 'Check the essentials',
        description: 'Key metrics keep valuation and operating context beside the chart so the price move is not read in isolation.',
        selector: '[data-widget-type="key_metrics"]',
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
        selector: '[data-widget-type="unified_financials"]',
      },
      {
        id: 'financial-tabs',
        title: 'Keep the company in context',
        description: 'Move between Financials, Overview, Ownership, and Technical views without losing the selected symbol.',
        selector: '[data-tour="tab-bar"]',
      },
    ],
    finalTitle: 'Your company review is ready',
    finalDescription: 'VniAgent will open with a financial-health starter prompt for the selected company.',
    finalAction: 'Analyze with VniAgent',
  },
  scan_market: {
    icon: BarChart3,
    result: 'Market overview',
    detail: 'Breadth, heatmap, sectors, index comparison, and movers.',
    requiresTicker: false,
    steps: [
      {
        id: 'market-pulse',
        title: 'Read the market pulse',
        description: 'The overview summarizes index direction and participation before you narrow the scan.',
        selector: '[data-widget-type="market_overview"]',
      },
      {
        id: 'market-heatmap',
        title: 'Find concentrated strength',
        description: 'The heatmap makes sector leadership and broad risk-off pressure visible at a glance.',
        selector: '[data-widget-type="market_heatmap"]',
      },
      {
        id: 'market-movers',
        title: 'Open the shortlist',
        description: 'Top movers turns the broad scan into concrete symbols for the next company or ticker review.',
        selector: '[data-widget-type="top_movers"]',
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

export function OnboardingWalkthrough({ open, currentSymbol, onSkip, onGoalSelect, onComplete }: OnboardingWalkthroughProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [stage, setStage] = useState<'goal' | 'ticker' | 'guide'>('goal')
  const [selectedGoal, setSelectedGoal] = useState<OnboardingGoalId | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [tickerInput, setTickerInput] = useState('')
  const [routeError, setRouteError] = useState('')
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
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

  useEffect(() => {
    if (!open || !currentStep?.selector || typeof window === 'undefined') {
      setTargetRect(null)
      return
    }

    let target: HTMLElement | null = null
    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null

    const updateRect = () => {
      if (target) setTargetRect(target.getBoundingClientRect())
    }
    const scheduleUpdate = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(updateRect)
    }
    const bindTarget = () => {
      if (target) return true
      target = document.querySelector<HTMLElement>(currentStep.selector as string)
      if (!target) return false
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate)
      resizeObserver?.observe(target)
      scheduleUpdate()
      mutationObserver?.disconnect()
      return true
    }

    setTargetRect(null)
    if (!bindTarget()) {
      mutationObserver = new MutationObserver(bindTarget)
      mutationObserver.observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [currentStep?.selector, open])

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
    ? 'VNIBB will open the working view first, then show the two or three controls that matter for that workflow.'
    : stage === 'ticker'
      ? 'Search a popular Vietnam stock or enter its three-character symbol.'
      : isFinalStep
        ? presentation?.finalDescription
        : currentStep?.description

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[140]">
      <div className={highlightStyle ? 'pointer-events-auto fixed inset-0' : 'pointer-events-auto fixed inset-0 bg-[rgba(2,6,23,0.76)] backdrop-blur-[2px]'} />
      {highlightStyle ? <div aria-hidden="true" className="pointer-events-none fixed rounded-xl border border-sky-300/70 bg-transparent shadow-[0_0_0_9999px_rgba(2,6,23,0.74),0_0_36px_rgba(56,189,248,0.18)] transition-all duration-300" style={highlightStyle} /> : null}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="VNIBB walkthrough" className="pointer-events-auto fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[rgba(9,14,24,0.98)] p-5 text-left text-[var(--text-primary)] shadow-[0_24px_90px_rgba(2,6,23,0.55)] animate-in fade-in zoom-in-95 duration-200" style={panelStyle}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-sky-200/80">
              <Sparkles size={12} />
              VNIBB quick start
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-50">{title}</h2>
          </div>
          <button type="button" onClick={stage === 'guide' ? () => finish() : closeAndRestoreFocus} className="min-h-9 min-w-9 rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100" aria-label="Close walkthrough">
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 max-w-[48ch] text-sm leading-6 text-slate-300">{description}</p>

        {stage === 'goal' ? (
          <div className="mt-5 divide-y divide-white/8 border-y border-white/8">
            {ONBOARDING_GOALS.map((goal, index) => {
              const goalPresentation = GOAL_PRESENTATION[goal.id]
              const Icon = goalPresentation.icon
              return (
                <button key={goal.id} type="button" data-walkthrough-initial-focus={index === 0 ? 'true' : undefined} onClick={() => chooseGoal(goal.id)} className="group grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 py-4 text-left transition-colors hover:text-sky-100">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.045] text-slate-300 transition-colors group-hover:bg-sky-400/10 group-hover:text-sky-200"><Icon size={18} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-100">{goal.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">{goalPresentation.detail}</span>
                  </span>
                  <ArrowRight size={16} className="text-slate-600 transition-transform group-hover:translate-x-1 group-hover:text-sky-300" />
                </button>
              )
            })}
          </div>
        ) : null}

        {stage === 'ticker' ? (
          <form className="mt-5" onSubmit={(event) => { event.preventDefault(); submitTicker() }}>
            <label htmlFor="walkthrough-ticker" className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Vietnam ticker</label>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-sky-400/60">
              <Search size={16} className="text-slate-500" />
              <input id="walkthrough-ticker" data-walkthrough-initial-focus="true" value={tickerInput} onChange={(event) => { setTickerInput(event.target.value.toUpperCase()); setRouteError('') }} autoComplete="off" className="min-h-12 w-full bg-transparent text-sm font-semibold uppercase tracking-[0.08em] text-slate-50 outline-none placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-600" placeholder="Search FPT, VNM, MBB..." />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {suggestions.map((stock) => (
                <button key={stock.symbol} type="button" onClick={() => { setTickerInput(stock.symbol); setRouteError('') }} className={tickerInput === stock.symbol ? 'rounded-lg border border-sky-400/50 bg-sky-400/10 px-3 py-2 text-left' : 'rounded-lg border border-white/8 px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.035]'}>
                  <span className="block text-xs font-bold text-slate-100">{stock.symbol}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-500">{stock.name}</span>
                </button>
              ))}
            </div>
            {routeError ? <p role="alert" className="mt-3 text-xs font-medium text-amber-300">{routeError}</p> : null}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => { setStage('goal'); setSelectedGoal(null); setRouteError('') }} className="inline-flex min-h-10 items-center gap-1.5 px-1 text-xs font-semibold text-slate-400 hover:text-slate-100"><ArrowLeft size={14} />Back</button>
              <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-300">Open {presentation?.result}<ArrowRight size={14} /></button>
            </div>
          </form>
        ) : null}

        {stage === 'goal' && routeError ? <p role="alert" className="mt-3 text-xs font-medium text-amber-300">{routeError}</p> : null}

        {stage === 'guide' ? (
          <>
            <div className="mt-5 flex items-center gap-1.5">
              {guidanceSteps.map((step, index) => <span key={step.id} className={index === stepIndex ? 'h-1.5 flex-1 rounded-full bg-sky-300' : index < stepIndex || isFinalStep ? 'h-1.5 flex-1 rounded-full bg-sky-400/55' : 'h-1.5 flex-1 rounded-full bg-white/10'} />)}
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{progressLabel}</span>
            </div>
            {isFinalStep ? (
              <div className="mt-5 flex items-center gap-3 border-y border-white/8 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-emerald-300"><Check size={18} /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Outcome opened</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">You can restart this guide from Settings.</p>
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => finish()} className="min-h-9 text-xs font-semibold text-slate-400 transition-colors hover:text-white">Exit tour</button>
              <div className="flex items-center gap-2">
                {!isFinalStep && stepIndex > 0 ? <button type="button" onClick={() => setStepIndex((current) => current - 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"><ArrowLeft size={14} />Back</button> : null}
                <button type="button" data-walkthrough-initial-focus="true" onClick={() => isFinalStep ? finish(selectedGoal !== 'scan_market') : setStepIndex((current) => current + 1)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-300">
                  {isFinalStep ? <><Check size={14} />{presentation?.finalAction}</> : <>Next<ArrowRight size={14} /></>}
                </button>
              </div>
            </div>
          </>
        ) : stage === 'goal' ? (
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={closeAndRestoreFocus} className="min-h-9 text-xs font-semibold text-slate-400 transition-colors hover:text-white">Skip for now</button>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{progressLabel}</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
