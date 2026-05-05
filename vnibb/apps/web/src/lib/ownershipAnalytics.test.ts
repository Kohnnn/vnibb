import { buildOwnershipSummary } from '@/lib/ownershipAnalytics'

describe('ownershipAnalytics', () => {
  test('buildOwnershipSummary scores constructive ownership setups higher', () => {
    const summary = buildOwnershipSummary(
      [
        { symbol: 'VCI', shareholder_name: 'Fund A', ownership_pct: 0.18, shareholder_type: 'institutional fund' },
        { symbol: 'VCI', shareholder_name: 'Fund B', ownership_pct: 0.12, shareholder_type: 'institutional fund' },
        { symbol: 'VCI', shareholder_name: 'Foreign Desk', ownership_pct: 0.09, shareholder_type: 'foreign institution' },
      ],
      [{ buy_volume: 2_000_000, sell_volume: 1_100_000 }],
      { symbol: 'VCI', period_days: 90, buy_count: 2, sell_count: 0, buy_value: 10_000_000_000, sell_value: 0, net_value: 10_000_000_000, sentiment_score: 75, total_deals: 2 }
    )

    expect(summary.grade).toBe('A')
    expect(summary.top3Pct).toBeCloseTo(39, 1)
    expect(summary.foreignNetVolume).toBe(900000)
  })
})
