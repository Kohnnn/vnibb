import type { DividendCoverage, DividendRecord, DividendsResponse } from '@/lib/api'

export function qualifiedDividendHistory(
  data: DividendRecord[],
  coverage: Partial<DividendCoverage> = {},
): DividendsResponse {
  return {
    data,
    meta: {
      count: data.length,
      coverage: {
        scope: 'retained_observations',
        status: data.length ? 'partial' : 'unavailable',
        latest_covered_date: null,
        latest_covered_date_type: null,
        admitted_count: data.length,
        discrepancy_count: 0,
        discrepancies: [],
        payout_window_certified: false,
        annual_dps_unavailable_reason: 'uncertified_payout_window',
        yield_unavailable_reason: 'uncertified_payout_window_and_price_basis',
        ...coverage,
      },
    },
  }
}

export const cashTerms = { currency: 'VND', cash_unit: 'VND/share' } as const
export const stockTerms = { stock_unit: 'percent_of_existing_shares' } as const
