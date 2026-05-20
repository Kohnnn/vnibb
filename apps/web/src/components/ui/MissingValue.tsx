'use client';

/**
 * Smart placeholder for missing or unavailable metric values.
 *
 * Replaces ad-hoc "—" / "N/A" strings scattered across widgets so the user
 * gets a tooltip-driven explanation distinguishing four classes of "missing":
 *
 *   - `market_closed`   the value resumes at next session open (intraday only)
 *   - `data_unavailable` the metric exists in the schema but the upstream
 *                       provider didn't ship a value (also covers stale sync)
 *   - `not_applicable`   the metric does not apply to this security type
 *                       (e.g. EV/Sales for a securities firm without revenue)
 *   - `insufficient_history` the symbol simply doesn't have enough historical
 *                       data to compute the metric (e.g. Beta 63D needs 63
 *                       trading days)
 *
 * The visible glyph defaults to "—" (en dash) to match the existing UI; for
 * `not_applicable` we render "N/A" since users find that clearer.
 */

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type MissingValueReason =
  | 'market_closed'
  | 'data_unavailable'
  | 'not_applicable'
  | 'insufficient_history';

interface MissingValueProps {
  reason?: MissingValueReason;
  /** Optional override for the tooltip message. */
  detail?: string;
  className?: string;
  /** Custom glyph (rare — defaults are "—" or "N/A"). */
  glyph?: ReactNode;
}

const DEFAULT_DETAILS: Record<MissingValueReason, string> = {
  market_closed: 'Resumes at the next session open.',
  data_unavailable: 'Provider did not ship a value for this period.',
  not_applicable: 'Not reported for this security type.',
  insufficient_history: 'Insufficient history to compute this metric.',
};

const DEFAULT_GLYPH: Record<MissingValueReason, string> = {
  market_closed: '—',
  data_unavailable: '—',
  not_applicable: 'N/A',
  insufficient_history: '—',
};

export function MissingValue({
  reason = 'data_unavailable',
  detail,
  className,
  glyph,
}: MissingValueProps) {
  const tooltipText = detail || DEFAULT_DETAILS[reason];
  const glyphContent = glyph ?? DEFAULT_GLYPH[reason];

  return (
    <span
      className={cn('cursor-help text-[var(--text-muted)] decoration-dotted underline-offset-2 hover:underline', className)}
      title={tooltipText}
      data-missing-reason={reason}
      aria-label={tooltipText}
    >
      {glyphContent}
    </span>
  );
}

export default MissingValue;
