'use client'

import { useEffect, useRef } from 'react'

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
}: {
  enabled: boolean
  onClose?: () => void
}) {
  const dialogRef = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    const dialog = dialogRef.current
    if (!dialog) {
      return
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    activeDialogs.push(dialog)
    const isTopDialog = () => activeDialogs[activeDialogs.length - 1] === dialog

    const focusDialog = () => {
      if (!isTopDialog()) return
      const firstFocusable = getFocusableElements(dialog)[0]
      ;(firstFocusable || dialog).focus({ preventScroll: true })
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
      if (wasTopDialog && previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [enabled])

  return dialogRef
}
