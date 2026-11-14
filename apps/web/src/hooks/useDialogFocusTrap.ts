'use client'

import { useEffect, useRef, type RefObject } from 'react'

const activeDialogs: HTMLElement[] = []

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
}) {
  const dialogRef = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const returnFocusToRef = useRef(returnFocusTo)
  returnFocusToRef.current = returnFocusTo
  const initialFocusToRef = useRef(initialFocusTo)
  initialFocusToRef.current = initialFocusTo

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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

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

    const handleFocusIn = (event: FocusEvent) => {
      if (isTopDialog() && event.target instanceof Node && !dialog.contains(event.target)) {
        focusDialog()
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      window.clearTimeout(focusTimeout)
      window.clearTimeout(frameRetry)
      dialog.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      const wasTopDialog = isTopDialog()
      activeDialogs.splice(activeDialogs.lastIndexOf(dialog), 1)
      // A reparent (inline <-> portal at the 767px boundary) swaps the element
      // while the dialog stays open. Restoring outward then strands focus on
      // BODY outside the still-open dialog, so a live replacement node means
      // "keep containing", not "closed".
      const reparented = dialogRef.current !== dialog && Boolean(dialogRef.current?.isConnected)
      const returnTarget = returnFocusToRef.current?.current ?? previouslyFocused
      if (wasTopDialog && !reparented && returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true })
      }
    }
  }, [enabled])

  return dialogRef
}
