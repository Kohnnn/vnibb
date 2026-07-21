import { calculatePortfolioConcentration, calculatePortfolioValuation } from './portfolioAnalytics'

describe('portfolioAnalytics', () => {
  it('keeps unpriced cost basis out of market value and aggregate P/L', () => {
    expect(calculatePortfolioValuation([
      { quantity: 2, avgCost: 100, currentPrice: 120 },
      { quantity: 3, avgCost: 50, currentPrice: null },
    ])).toEqual({
      quotedMarketValue: 240,
      quotedCostBasis: 200,
      unpricedCostBasis: 150,
      totalCostBasis: 350,
      quotedPositionCount: 1,
      unpricedPositionCount: 1,
      positionCount: 2,
      marketValue: null,
      unrealizedPL: null,
      unrealizedPLPct: null,
    })
  })

  it('calculates holding and sector concentration with quote coverage', () => {
    const summary = calculatePortfolioConcentration([
      { symbol: 'FPT', marketValue: 50, sector: 'Technology', hasLiveQuote: true },
      { symbol: 'VCB', marketValue: 25, sector: 'Financials', hasLiveQuote: true },
      { symbol: 'MBB', marketValue: 15, sector: 'Financials', hasLiveQuote: false },
      { symbol: 'GAS', marketValue: 10, sector: 'Energy', hasLiveQuote: false },
    ])

    expect(summary.largestHolding).toEqual({ symbol: 'FPT', weight: 0.5 })
    expect(summary.topThreeWeight).toBeCloseTo(0.9)
    expect(summary.hhi).toBeCloseTo(0.345)
    expect(summary.effectivePositions).toBeCloseTo(1 / 0.345)
    expect(summary.largestSector).toEqual({ name: 'Technology', weight: 0.5 })
    expect(summary.quotedPositionCount).toBe(2)
    expect(summary.resolvedSectorPositionCount).toBe(4)
    expect(summary.unresolvedSectorPositionCount).toBe(0)
    expect(summary.resolvedSectorValue).toBe(100)
    expect(summary.unresolvedSectorValue).toBe(0)
    expect(summary.positionCount).toBe(4)
  })

  it('keeps unresolved holdings out of sector allocation', () => {
    const summary = calculatePortfolioConcentration([
      { symbol: 'FPT', marketValue: 80, sector: 'Technology', hasLiveQuote: true },
      { symbol: 'UNKNOWN', marketValue: 20, sector: null, hasLiveQuote: false },
    ])

    expect(summary.sectors).toEqual([{ name: 'Technology', value: 80, weight: 1 }])
    expect(summary.resolvedSectorPositionCount).toBe(1)
    expect(summary.unresolvedSectorPositionCount).toBe(1)
    expect(summary.resolvedSectorValue).toBe(80)
    expect(summary.unresolvedSectorValue).toBe(20)
  })

  it('reports all holdings and value as unresolved when no sector profile resolves', () => {
    const summary = calculatePortfolioConcentration([
      { symbol: 'AAA', marketValue: 60, sector: null, hasLiveQuote: true },
      { symbol: 'BBB', marketValue: 40, sector: null, hasLiveQuote: false },
    ])

    expect(summary.sectors).toEqual([])
    expect(summary.resolvedSectorPositionCount).toBe(0)
    expect(summary.unresolvedSectorPositionCount).toBe(2)
    expect(summary.resolvedSectorValue).toBe(0)
    expect(summary.unresolvedSectorValue).toBe(100)
  })

  it('returns zero concentration when no position has positive value', () => {
    const summary = calculatePortfolioConcentration([
      { symbol: 'FPT', marketValue: 0, sector: 'Technology', hasLiveQuote: false },
      { symbol: 'VCB', marketValue: Number.NaN, sector: 'Financials', hasLiveQuote: false },
    ])

    expect(summary.totalValue).toBe(0)
    expect(summary.largestHolding).toBeNull()
    expect(summary.topThreeWeight).toBe(0)
    expect(summary.hhi).toBe(0)
    expect(summary.effectivePositions).toBe(0)
    expect(summary.largestSector).toBeNull()
  })
})
