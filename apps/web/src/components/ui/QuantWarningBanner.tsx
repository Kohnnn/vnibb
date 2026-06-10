'use client'

import { AlertTriangle } from 'lucide-react'

interface QuantWarningBannerProps {
  warning?: string | null
  /** Optional forward-looking disclosure for metrics that use forward windows. */
  forwardLooking?: boolean
  className?: string
}

/**
 * Compact inline banner that surfaces the backend quant `warning` /
 * `data_quality_note` (staleness, insufficient history, merged-quote) that most
 * quant widgets previously dropped. Renders nothing when there is no warning and
 * no forward-looking disclosure.
 */
export function QuantWarningBanner({ warning, forwardLooking, className }: QuantWarningBannerProps) {
  if (!warning && !forwardLooking) return null
  return (
    <div className={className}>
      {warning && (
        <div className="flex items-start gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-4 text-amber-300">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{warning}</span>
        </div>
      )}
      {forwardLooking && (
        <div className="mt-1 rounded border border-violet-500/25 bg-violet-500/5 px-2 py-1 text-[9px] leading-3 text-violet-200/90">
          Forward-looking statistic: uses future bars relative to the signal date. Not a point-in-time tradable signal.
        </div>
      )}
    </div>
  )
}

export default QuantWarningBanner
