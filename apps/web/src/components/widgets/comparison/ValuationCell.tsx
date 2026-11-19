import type { ValuationEvidence, ValuationKey } from '@/lib/api'
import { normalizeFinancialPeriod } from '@/lib/financialPeriods'

export function valuationKey(metric: string): ValuationKey | undefined {
  if (metric === 'ps' || metric === 'ps_ratio') return 'ps_ratio'
  if (metric === 'ev_ebitda') return metric
}

const origins = { screener: 'Screener', persisted_ratio: 'Stored ratio', provider_ratio: 'Provider ratio' }

// Require a complete label before normalization, which can extract tokens from free text.
const datedFiscalLabels = [
  /^(?:20\d{2}|FY\s*20\d{2}|20\d{2}\s*FY)$/i,
  /^(?:Q[1-4][-_\/ ]?20\d{2}|20\d{2}[-_\/ ]?Q[1-4]|[1-4][-_\/]20\d{2})$/i,
  /^(?:TTM[- ]?20\d{2}|20\d{2}\s*(?:YTD|\(YTD\)))$/i,
]

function fiscalPeriodIdentity(period: string | null | undefined): string | null {
  const label = period?.trim()
  return label && datedFiscalLabels.some(pattern => pattern.test(label))
    ? normalizeFinancialPeriod(label)
    : null
}

export function ValuationCell({ label, ticker, metric, evidence, snapshot = false }: {
  label: string
  ticker: string
  metric: ValuationKey
  evidence?: ValuationEvidence | null
  snapshot?: boolean
}) {
  const period = evidence?.fiscal_period
  const fiscal = period && fiscalPeriodIdentity(period) ? period : 'unknown'
  return (
    <div className="text-right">
      <span className="font-semibold">{label}</span>
      <details className="whitespace-normal font-sans text-[10px] font-normal leading-tight text-[var(--text-secondary)]">
        <summary className="cursor-pointer" aria-label={`Basis for ${ticker} ${metric === 'ps_ratio' ? 'P/S' : 'EV/EBITDA'}, fiscal period: ${fiscal}`}>
          Fiscal: {fiscal}
        </summary>
        <div>Record: {snapshot ? 'Ratio snapshot' : evidence?.origin ? origins[evidence.origin] : 'unknown'}</div>
        <div>Source: {evidence?.source || 'unknown'}</div>
        <div>Valuation as-of: {evidence?.valuation_as_of || 'unknown'}</div>
        <div>Denominator basis: {evidence?.denominator_basis || 'unknown'}</div>
      </details>
    </div>
  )
}

export function ValuationCaption({ periods }: { periods: Array<string | null | undefined> }) {
  const mixed = new Set(periods.map(fiscalPeriodIdentity).filter(Boolean)).size > 1
  return (
    <caption className="px-2 py-1 text-left text-[10px] font-normal text-[var(--text-secondary)]">
      {mixed ? 'Mixed fiscal periods. ' : ''}EV/EBITDA and P/S are reported multiples, not verified like-for-like comparisons. Open a fiscal label for its basis.
    </caption>
  )
}
