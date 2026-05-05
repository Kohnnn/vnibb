import { buildGrowthBridgeRows, buildTTMSnapshotCards } from '@/lib/financialDiscovery'
import { normalizeUnitConfig } from '@/lib/units'

describe('financialDiscovery helpers', () => {
  test('buildTTMSnapshotCards formats key TTM values', () => {
    const cards = buildTTMSnapshotCards(
      {
        income: { period: '2025-TTM', revenue: 25_000_000_000, net_income: 5_000_000_000 },
        balance: { period: '2025-TTM', total_assets: 120_000_000_000, total_equity: 60_000_000_000 },
        cash_flow: { period: '2025-TTM', operating_cash_flow: 7_000_000_000, free_cash_flow: 3_000_000_000 },
      },
      normalizeUnitConfig({ display: 'USD', usdVndDefaultRate: 25_000 })
    )

    expect(cards.find((card) => card.label === 'Revenue')?.value).toBe('1.00M')
    expect(cards.find((card) => card.label === 'Net Income')?.value).toBe('0.20M')
  })

  test('buildGrowthBridgeRows maps annual and quarter growth payloads', () => {
    const rows = buildGrowthBridgeRows({
      yoy: { revenue_growth: 20, earnings_growth: 15, eps_growth: 12, ebitda_growth: 18, asset_growth: 7 },
      qoq: { revenue_growth: 10, earnings_growth: 8, eps_growth: 6, ebitda_growth: 9 },
    })

    expect(rows[0]).toEqual(expect.objectContaining({ key: 'revenue_growth', annual: 20, quarter: 10 }))
    expect(rows[4]).toEqual(expect.objectContaining({ key: 'asset_growth', annual: 7, quarter: null }))
  })
})
