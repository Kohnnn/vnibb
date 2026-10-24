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
      { symbol: 'VCI', shareholder_name: 'A', ownership_pct: 22, ownership_unit: 'percent', ownership_unit_status: 'explicit', shareholder_type: 'fund' },
      { symbol: 'VCI', shareholder_name: 'B', ownership_pct: 18, ownership_unit: 'percent', ownership_unit_status: 'explicit', shareholder_type: 'foreign' },
    ] as unknown as ShareholderData[]

    const summary = buildOwnershipSummary(shareholders, [], null)

    expect(summary.top3Pct).toBe(40)
  })

  it('preserves a small canonical percentage without multiplying it by 100', () => {
    expect(buildOwnershipSummary([{ symbol: 'VCI', ownership_pct: 0.3, ownership_unit: 'percent', ownership_unit_status: 'explicit' }], [], null).top3Pct).toBe(0.3)
  })

  it('preserves explicitly admitted zero ownership', () => {
    const summary = buildOwnershipSummary([{ symbol: 'VCI', ownership_pct: 0, ownership_unit: 'percent', ownership_unit_status: 'explicit' }], [{ buy_volume: 0, sell_volume: 0 }], {
      symbol: 'VCI', period_days: 90, buy_count: 0, sell_count: 0, buy_value: 0, sell_value: 0,
      net_value: 0, sentiment_score: 0, total_deals: 0, value_unit: 'VND',
    })
    expect(summary.top3Pct).toBe(0)
    expect(summary.coverage).toBe('complete')
    expect(summary.score).toBe(62)
  })

  it('withholds canonical numbers without explicit percent evidence', () => {
    for (const ownership_pct of [0, 0.3, 30]) {
      expect(buildOwnershipSummary([{ symbol: 'VCI', ownership_pct }], [], null).top3Pct).toBeNull()
    }
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
