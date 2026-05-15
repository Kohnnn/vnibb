import { buildOwnershipSummary } from './ownershipAnalytics'
import type { ShareholderData } from '@/types/equity'

describe('ownershipAnalytics', () => {
  it('reads provider ownership aliases when ownership_pct is missing', () => {
    const shareholders = [
      { symbol: 'VCI', shareholder_name: 'A', ownership: 0.22, shareholder_type: 'fund' },
      { symbol: 'VCI', shareholder_name: 'B', pct: 0.18, shareholder_type: 'foreign' },
      { symbol: 'VCI', shareholder_name: 'C', percent: 0.1, shareholder_type: 'company' },
    ] as unknown as ShareholderData[]

    const summary = buildOwnershipSummary(shareholders, [], null)

    expect(summary.holderCount).toBe(3)
    expect(summary.top3Pct).toBeCloseTo(50)
    expect(summary.top10Pct).toBeCloseTo(50)
    expect(summary.institutionalCount).toBe(2)
    expect(summary.foreignCount).toBe(1)
  })

  it('keeps percentage-scale ownership values unchanged', () => {
    const shareholders = [
      { symbol: 'VCI', shareholder_name: 'A', percentage: 22, shareholder_type: 'fund' },
      { symbol: 'VCI', shareholder_name: 'B', ownership_pct: 18, shareholder_type: 'foreign' },
    ] as unknown as ShareholderData[]

    const summary = buildOwnershipSummary(shareholders, [], null)

    expect(summary.top3Pct).toBe(40)
  })
})
