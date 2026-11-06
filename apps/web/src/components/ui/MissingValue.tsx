'use client';

/**
 * Smart placeholder for missing or unavailable metric values.
 *
 * Replaces ad-hoc dash / uppercase-N-A strings scattered across widgets so the user
 * gets a tooltip-driven explanation distinguishing the classes of "missing":
 *
 *   - `market_closed`   the value resumes at next session open (intraday only)
 *   - `data_unavailable` the metric exists in the schema but the upstream
 *                       provider didn't ship a value (also covers stale sync)
 *   - `not_applicable`   the metric does not apply to this security type
 *                       (e.g. EV/Sales for a securities firm without revenue)
 *   - `insufficient_history` the symbol simply doesn't have enough historical
 *                       data to compute the metric (e.g. Beta 63D needs 63
 *                       trading days)
 *   - `not_meaningful`   the value exists but the ratio cannot be interpreted
 *                       (e.g. P/E on a loss, a margin delta beyond its clamp)
 *
 * Glyph contract (#198): `n/a` means no value, `n/m` means a value that is not
 * meaningful. Neither is a measured zero, which must render as `0`. Never use
 * a bare dash for missing data — it reads as a measured flat.
 */

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type MissingValueReason =
  | 'market_closed'
  | 'data_unavailable'
  | 'not_applicable'
  | 'insufficient_history'
  | 'not_meaningful';

interface MissingValueProps {
  reason?: MissingValueReason;
  /** Optional override for the tooltip message. */
  detail?: string;
  className?: string;
  /** Custom glyph (rare — defaults are `n/a` or `n/m`). */
  glyph?: ReactNode;
}

const DEFAULT_DETAILS: Record<MissingValueReason, string> = {
  market_closed: 'Resumes at the next session open.',
  data_unavailable: 'Provider did not ship a value for this period.',
  not_applicable: 'Not reported for this security type.',
  insufficient_history: 'Insufficient history to compute this metric.',
  not_meaningful: 'Not meaningful for this period.',
};

const DEFAULT_GLYPH: Record<MissingValueReason, string> = {
  market_closed: 'n/a',
  data_unavailable: 'n/a',
  not_applicable: 'n/a',
  insufficient_history: 'n/a',
  not_meaningful: 'n/m',
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
