'use client'

import { useEffect, useRef, type RefObject } from 'react'

const activeDialogs: HTMLElement[] = []
// Only dialogs that opted into `inertBackground` can own the background, but
// the owner is always `activeDialogs`'s topmost entry — that is the same
// notion Escape, Tab and focus reclamation already use, so a nested non-opt-in
// trap layered above the inspector correctly becomes the reachable branch.
const backgroundOwners = new Set<HTMLElement>()
// First-touch base attributes. Snapshotted once per element and restored
// verbatim, so hosts that already carry `inert`/`aria-hidden` (a maximized
// widget's card) come back exactly as they were.
const backgroundBase = new Map<Element, { inert: string | null; ariaHidden: string | null }>()

function restoreBackground(element: Element, base: { inert: string | null; ariaHidden: string | null }) {
  if (base.inert === null) element.removeAttribute('inert')
  else element.setAttribute('inert', base.inert)
  if (base.ariaHidden === null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', base.ariaHidden)
}

function bodyChildOf(node: Element | undefined): Element | null {
  if (!node || typeof document === 'undefined') return null
  let current: Element = node
  while (current.parentElement && current.parentElement !== document.body) current = current.parentElement
  return current.parentElement === document.body ? current : null
}

function syncBackground() {
  if (typeof document === 'undefined') return
  if (backgroundOwners.size === 0) {
    for (const [element, base] of backgroundBase) restoreBackground(element, base)
    backgroundBase.clear()
    return
  }
  // The branch holding the topmost modal stays reachable; everything else is
  // removed from the keyboard and AT surfaces.
  const owned = bodyChildOf(activeDialogs[activeDialogs.length - 1])
  for (const element of Array.from(document.body.children)) {
    if (element === owned) {
      const base = backgroundBase.get(element)
      if (base) {
        restoreBackground(element, base)
        backgroundBase.delete(element)
      }
      continue
    }
    if (!backgroundBase.has(element)) {
      backgroundBase.set(element, { inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') })
    }
    element.setAttribute('inert', '')
    element.setAttribute('aria-hidden', 'true')
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  // Native tab stop; inner-frame keys stay in that context. ponytail: traversal is browser-owned until a provider offers a keyboard bridge.
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleElement)
}

export function useDialogFocusTrap<T extends HTMLElement>({
  enabled,
  onClose,
  returnFocusTo,
  initialFocusTo,
  inertBackground,
}: {
  enabled: boolean
  onClose?: () => void
  /**
   * The original opener for this open session. Pass it when the dialog can
   * reparent (inline <-> portal) while open: this effect only re-runs on
   * `enabled`, so after a reparent `document.activeElement` is already BODY
   * and would otherwise be captured as the "previous" target to restore.
   */
  returnFocusTo?: RefObject<HTMLElement | null>
  /** Overrides first-tabbable as the entry point (e.g. a search field). */
  initialFocusTo?: RefObject<HTMLElement | null>
  /**
   * Modal dialogs only. Inerts every `document.body` branch except the one
   * holding the topmost active dialog, so the obscured UI leaves both the
   * keyboard and the accessibility tree. Exact prior attributes are restored.
   * ponytail: a body child inserted while the dialog is open is not revisited;
   * add a MutationObserver only if a host starts mounting portals mid-dialog.
   */
  inertBackground?: boolean
}) {
  const dialogRef = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Synced after commit, not during render: the trap effect below must not
  // restart on opener-identity changes, so these stay separate from its deps.
  const returnFocusToRef = useRef(returnFocusTo)
  const initialFocusToRef = useRef(initialFocusTo)
  useEffect(() => {
    returnFocusToRef.current = returnFocusTo
    initialFocusToRef.current = initialFocusTo
  }, [returnFocusTo, initialFocusTo])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    // BODY means "nothing is focused", never a return target: a reparent or a
    // programmatic blur must not replace the real opener.
    const captured = document.activeElement
    const previouslyFocused = captured instanceof HTMLElement && captured !== document.body
      ? captured
      : null

    activeDialogs.push(dialog)
    if (inertBackground) backgroundOwners.add(dialog)
    syncBackground()
    const isTopDialog = () => activeDialogs[activeDialogs.length - 1] === dialog

    const focusDialog = () => {
      if (!isTopDialog()) return
      const preferred = initialFocusToRef.current?.current
      const target = preferred?.isConnected && dialog.contains(preferred)
        ? preferred
        : getFocusableElements(dialog)[0]
      ;(target || dialog).focus({ preventScroll: true })
    }

    const focusTimeout = window.setTimeout(focusDialog, 0)

    let frameRetry = 0
    // Firefox drops iframe.focus() inside a trusted keydown; retry once on the next task while the
    // dialog is still topmost and nothing else has claimed focus.
    const focusTarget = (target: HTMLElement) => {
      window.clearTimeout(frameRetry)
      const focusOrigin = document.activeElement
      target.focus({ preventScroll: true })
      if (!(target instanceof HTMLIFrameElement) || document.activeElement === target) return
      frameRetry = window.setTimeout(() => {
        if (!isTopDialog() || !target.isConnected || !dialog.contains(target)) return
        if (document.activeElement !== focusOrigin) return
        target.focus({ preventScroll: true })
      }, 0)
    }

    // Escape must not depend on where focus ended up: a modal whose focus was
    // stranded outside its subtree (focus timeout, reparent, opener restore) is
    // still the topmost dialog and must close. Document bubble keeps every inner
    // overlay's precedence — one that stops propagation above us wins — and a
    // descendant dialog owns its own Escape, so one Escape closes one layer.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !onCloseRef.current || !isTopDialog()) return
      const target = event.target
      const nestedDialog = target instanceof Element ? target.closest('[role="dialog"]') : null
      if (nestedDialog && nestedDialog !== dialog) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog() || event.key !== 'Tab') return

      const focusableElements = getFocusableElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }

      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey) {
        if (activeElement === firstFocusable || !dialog.contains(activeElement)) {
          event.preventDefault()
          focusTarget(lastFocusable)
        }
        return
      }

      if (activeElement === lastFocusable || !dialog.contains(activeElement)) {
        event.preventDefault()
        focusTarget(firstFocusable)
      }
    }

    // A nested overlay may own focus while open — e.g. a ticker picker or a
    // Matrix inspector portalled to body from inside this dialog. Reclaiming
    // would steal focus back to this layer and strand the picker.
    const ownedDialog = (node: EventTarget | null) => node instanceof Element
      ? node.closest('[role="dialog"]')
      : null

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopDialog() || !(event.target instanceof Node) || dialog.contains(event.target)) return
      const nested = ownedDialog(event.target)
      if (nested && nested !== dialog) return
      focusDialog()
    }

    document.addEventListener('keydown', handleEscape)
    dialog.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      window.clearTimeout(focusTimeout)
      window.clearTimeout(frameRetry)
      document.removeEventListener('keydown', handleEscape)
      dialog.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      const wasTopDialog = isTopDialog()
      activeDialogs.splice(activeDialogs.lastIndexOf(dialog), 1)
      backgroundOwners.delete(dialog)
      // Restore before the trap returns focus: an inert opener refuses focus.
      syncBackground()
      // A reparent (inline <-> portal at the 767px boundary) swaps the element
      // while the dialog stays open. Restoring outward then strands focus on
      // BODY outside the still-open dialog, so a live replacement node means
      // "keep containing", not "closed".
      const reparented = dialogRef.current !== dialog && Boolean(dialogRef.current?.isConnected)
      const returnTarget = returnFocusToRef.current?.current ?? previouslyFocused
      if (wasTopDialog && !reparented && returnTarget?.isConnected) {
        // A surviving modal inerted the branch this opener sits in, so focusing
        // it would silently land on BODY and leave Escape dead for that modal.
        // Hand focus into the surviving topmost dialog instead.
        const surviving = backgroundOwners.size > 0 ? activeDialogs[activeDialogs.length - 1] : undefined
        if (surviving && bodyChildOf(returnTarget)?.hasAttribute('inert')) {
          ;(getFocusableElements(surviving)[0] ?? surviving).focus({ preventScroll: true })
        } else {
          returnTarget.focus({ preventScroll: true })
        }
      }
    }
  }, [enabled])

  return dialogRef
}
