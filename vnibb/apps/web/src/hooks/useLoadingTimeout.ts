import { useEffect, useState } from 'react'

interface UseLoadingTimeoutOptions {
  timeoutMs?: number
  enabled?: boolean
}

interface UseLoadingTimeoutResult {
  timedOut: boolean
  resetTimeout: () => void
}

export function useLoadingTimeout(
  isLoading: boolean,
  options: UseLoadingTimeoutOptions = {}
): UseLoadingTimeoutResult {
  const { timeoutMs = 15_000, enabled = true } = options
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!enabled || !isLoading) {
      setTimedOut(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setTimedOut(true)
    }, timeoutMs)

    return () => window.clearTimeout(timeoutId)
  }, [enabled, isLoading, timeoutMs])

  return {
    timedOut,
    resetTimeout: () => setTimedOut(false),
  }
}

export default useLoadingTimeout
