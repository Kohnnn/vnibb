import { buildOwnershipSummary } from './ownershipAnalytics'
import type { ShareholderData } from '@/types/equity'

describe('ownershipAnalytics', () => {
  it('withholds ambiguous aliases rather than inferring their scale from magnitude', () => {
    const shareholders = [
      { symbol: 'VCI', shareholder_name: 'A', ownership: 0.22, shareholder_type: 'fund' },
      { symbol: 'VCI', shareholder_name: 'B', pct: 0.18, shareholder_type: 'foreign' },
    ] as unknown as ShareholderData[]

    const summary = buildOwnershipSummary(shareholders, [], null)

    expect(summary.holderCount).toBe(2)
    expect(summary.top3Pct).toBeNull()
    expect(summary.score).toBeNull()
    expect(summary.institutionalCount).toBe(1)
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

  it('preserves a small canonical percentage without multiplying it by 100', () => {
    expect(buildOwnershipSummary([{ symbol: 'VCI', ownership_pct: 0.3 }], [], null).top3Pct).toBe(0.3)
  })

  it('does not fabricate a net flow when either side is absent or non-finite', () => {
    for (const row of [{ buy_volume: 10 }, { sell_volume: 10 }, { buy_volume: NaN, sell_volume: 0 }]) {
      expect(buildOwnershipSummary(null, [row], null).foreignNetVolume).toBeNull()
    }
    expect(buildOwnershipSummary(null, [{ buy_volume: 0, sell_volume: 0 }], null).foreignNetVolume).toBe(0)
  })

  it('distinguishes an unanswered shareholder source from a successful empty sample', () => {
    expect(buildOwnershipSummary(null, null, null).holderCount).toBeNull()
    expect(buildOwnershipSummary([], [], null).holderCount).toBe(0)
    expect(buildOwnershipSummary([], [], null).score).toBeNull()
  })
})
