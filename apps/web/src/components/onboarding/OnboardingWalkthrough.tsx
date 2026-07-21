'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics'
import { ONBOARDING_GOALS, ONBOARDING_MEANINGFUL_ACTION_EVENT, type OnboardingGoalId, type OnboardingMeaningfulActionId } from '@/lib/userPreferences'

type WalkthroughStep = {
  id: string
  title: string
  description: string
  selector?: string
}

interface OnboardingWalkthroughProps {
  open: boolean
  onSkip: () => void
  onGoalSelect: (goalId: OnboardingGoalId) => void
  onMeaningfulAction: (actionId: OnboardingMeaningfulActionId) => void
}

const BASE_STEPS: WalkthroughStep[] = [
  {
    id: 'header',
    title: 'Header tools',
    description: 'Search any symbol here, then use quick actions like Auto-Fit and layout lock for the current workspace.',
    selector: '[data-tour="header-bar"]',
  },
  {
    id: 'tabs',
    title: 'Tabs',
    description: 'Tabs split one workspace into focused views, so you can compare setups without rebuilding the whole dashboard.',
    selector: '[data-tour="tab-bar"]',
  },
  {
    id: 'widget-settings',
    title: 'Widget settings',
    description: 'Use this on any widget to adjust refresh behavior, config, and other widget-specific options.',
    selector: '[data-tour="widget-settings-trigger"]',
  },
]

const GOAL_STEP: WalkthroughStep = {
  id: 'goal',
  title: 'What do you want to do?',
  description: 'Choose one workflow to open an existing VNIBB view and VniAgent starter prompt.',
}

const FINAL_STEP: WalkthroughStep = {
  id: 'done',
  title: 'You are ready',
  description: 'That is the core VNIBB flow. You can restart this walkthrough anytime in Settings.',
}

const VIEWPORT_PADDING = 16
const PANEL_WIDTH = 320
const HIGHLIGHT_PADDING = 10
const PANEL_ESTIMATED_HEIGHT = 264

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function OnboardingWalkthrough({ open, onSkip, onGoalSelect, onMeaningfulAction }: OnboardingWalkthroughProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [steps, setSteps] = useState<WalkthroughStep[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!open) {
      setTargetRect(null)
      return
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const availableSteps = BASE_STEPS.filter((step) => !step.selector || Boolean(document.querySelector(step.selector)))
    setSteps([GOAL_STEP, ...availableSteps, FINAL_STEP])
    setStepIndex(0)
  }, [open])

  const currentStep = steps[stepIndex] ?? GOAL_STEP
  const isGoalStep = currentStep.id === GOAL_STEP.id
  const isFinalStep = currentStep.id === FINAL_STEP.id

  useEffect(() => {
    if (!open || !currentStep.id) {
      return
    }

    captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingWalkthroughStepViewed, {
      step_id: currentStep.id,
      step_index: stepIndex,
    })
  }, [currentStep.id, open, stepIndex])

  useEffect(() => {
    if (!open || !currentStep.selector || typeof window === 'undefined') {
      setTargetRect(null)
      return
    }

    const target = document.querySelector<HTMLElement>(currentStep.selector)
    if (!target) {
      setTargetRect(null)
      return
    }

    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })

    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null
    const updateRect = () => setTargetRect(target.getBoundingClientRect())
    const scheduleUpdate = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(updateRect)
    }

    scheduleUpdate()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleUpdate)
      resizeObserver.observe(target)
    }

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      resizeObserver?.disconnect()
    }
  }, [currentStep.selector, open])

  const closeAndRestoreFocus = () => {
    onSkip()
    window.requestAnimationFrame(() => openerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const handleMeaningfulAction = (event: Event) => {
      if (event instanceof CustomEvent) {
        const actionId = event.detail?.actionId as OnboardingMeaningfulActionId | undefined
        if (actionId) onMeaningfulAction(actionId)
      }
    }
    window.addEventListener(ONBOARDING_MEANINGFUL_ACTION_EVENT, handleMeaningfulAction)

    const focusInitialControl = () => {
      const initialControl = dialogRef.current?.querySelector<HTMLElement>('[data-walkthrough-initial-focus="true"]')
      initialControl?.focus()
    }
    const timeoutId = window.setTimeout(focusInitialControl, 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAndRestoreFocus()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }

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
      window.removeEventListener(ONBOARDING_MEANINGFUL_ACTION_EVENT, handleMeaningfulAction)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onMeaningfulAction, open])

  const highlightStyle = useMemo(() => {
    if (!open || !targetRect || typeof window === 'undefined') {
      return null
    }

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
    if (typeof window === 'undefined') {
      return { left: VIEWPORT_PADDING, top: VIEWPORT_PADDING, width: PANEL_WIDTH }
    }

    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
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
  }, [highlightStyle])

  if (!isMounted || !open) {
    return null
  }

  const guidedStepCount = Math.max(steps.length - 2, 1)
  const progressLabel = isGoalStep ? 'Start' : isFinalStep ? `${guidedStepCount} of ${guidedStepCount}` : `${stepIndex} of ${guidedStepCount}`

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[140]">
      <div className={highlightStyle ? 'fixed inset-0 pointer-events-none' : 'fixed inset-0 pointer-events-none bg-[rgba(2,6,23,0.72)]'} />
      {highlightStyle ? (
        <div aria-hidden="true" className="pointer-events-none fixed rounded-2xl border border-sky-400/70 bg-transparent shadow-[0_0_0_9999px_rgba(2,6,23,0.72)] transition-all duration-200" style={highlightStyle} />
      ) : null}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="VNIBB walkthrough" className="pointer-events-auto fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[rgba(10,15,26,0.98)] p-4 text-left text-[var(--text-primary)] shadow-[0_24px_80px_rgba(2,6,23,0.4)]" style={panelStyle}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-200/80">Quick walkthrough</div>
            <h2 className="mt-2 text-base font-semibold text-slate-100">{currentStep.title}</h2>
          </div>
          <button type="button" onClick={closeAndRestoreFocus} className="min-h-9 min-w-9 rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100" aria-label="Close walkthrough">
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-200/88">{currentStep.description}</p>
        {isGoalStep ? (
          <div className="mt-4 grid gap-2">
            {ONBOARDING_GOALS.map((goal, index) => (
              <button key={goal.id} type="button" data-walkthrough-initial-focus={index === 0 ? 'true' : undefined} onClick={() => {
                captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingGoalSelected, { goal_id: goal.id })
                onGoalSelect(goal.id)
              }} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-left transition-colors hover:border-sky-300/50 hover:bg-sky-400/10">
                <span className="block text-sm font-semibold text-slate-100">{goal.label}</span>
                <span className="mt-0.5 block text-xs text-slate-300">{goal.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex items-center gap-1.5">
          {steps.slice(1, -1).map((step, index) => {
            const actualIndex = index + 1
            const active = !isGoalStep && !isFinalStep && actualIndex === stepIndex
            const complete = isFinalStep || actualIndex < stepIndex
            return <span key={step.id} className={active ? 'h-1.5 w-8 rounded-full bg-sky-300' : complete ? 'h-1.5 w-8 rounded-full bg-sky-400/60' : 'h-1.5 w-8 rounded-full bg-white/10'} />
          })}
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{progressLabel}</span>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" onClick={closeAndRestoreFocus} className="min-h-9 text-xs font-semibold text-slate-300 transition-colors hover:text-white">{isFinalStep ? 'Close' : 'Skip'}</button>
          {!isGoalStep ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40">
                <ArrowLeft size={14} />
                Back
              </button>
              <button type="button" data-walkthrough-initial-focus="true" onClick={() => {
                if (isFinalStep || stepIndex >= steps.length - 1) {
                  closeAndRestoreFocus()
                  return
                }
                setStepIndex((current) => current + 1)
              }} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400">
                {isFinalStep ? <><Check size={14} />Done</> : <>Next<ArrowRight size={14} /></>}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
