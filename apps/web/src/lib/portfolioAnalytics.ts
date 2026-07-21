export interface PortfolioValuationPosition {
  quantity: number
  avgCost: number
  currentPrice: number | null
}

export interface PortfolioValuationSummary {
  quotedMarketValue: number
  quotedCostBasis: number
  unpricedCostBasis: number
  totalCostBasis: number
  quotedPositionCount: number
  unpricedPositionCount: number
  positionCount: number
  marketValue: number | null
  unrealizedPL: number | null
  unrealizedPLPct: number | null
}

export function calculatePortfolioValuation(positions: PortfolioValuationPosition[]): PortfolioValuationSummary {
  const normalized = positions.map((position) => {
    const quantity = Number.isFinite(position.quantity) && position.quantity > 0 ? position.quantity : 0
    const avgCost = Number.isFinite(position.avgCost) && position.avgCost >= 0 ? position.avgCost : 0
    const currentPrice = Number.isFinite(position.currentPrice) && (position.currentPrice as number) > 0
      ? position.currentPrice as number
      : null
    return { quantity, costBasis: quantity * avgCost, currentPrice }
  })
  const quoted = normalized.filter((position) => position.currentPrice !== null)
  const quotedMarketValue = quoted.reduce((sum, position) => sum + position.quantity * (position.currentPrice as number), 0)
  const quotedCostBasis = quoted.reduce((sum, position) => sum + position.costBasis, 0)
  const unpricedCostBasis = normalized
    .filter((position) => position.currentPrice === null)
    .reduce((sum, position) => sum + position.costBasis, 0)
  const totalCostBasis = quotedCostBasis + unpricedCostBasis
  const unpricedPositionCount = normalized.length - quoted.length
  const marketValue = unpricedPositionCount === 0 ? quotedMarketValue : null
  const unrealizedPL = marketValue === null ? null : marketValue - totalCostBasis
  const unrealizedPLPct = unrealizedPL !== null && totalCostBasis > 0 ? (unrealizedPL / totalCostBasis) * 100 : null
  return {
    quotedMarketValue,
    quotedCostBasis,
    unpricedCostBasis,
    totalCostBasis,
    quotedPositionCount: quoted.length,
    unpricedPositionCount,
    positionCount: normalized.length,
    marketValue,
    unrealizedPL,
    unrealizedPLPct,
  }
}

export interface PortfolioConcentrationPosition {
  symbol: string
  marketValue: number
  sector: string | null
  hasLiveQuote: boolean
}

export interface PortfolioConcentrationSummary {
  totalValue: number
  positionCount: number
  quotedPositionCount: number
  resolvedSectorPositionCount: number
  unresolvedSectorPositionCount: number
  resolvedSectorValue: number
  unresolvedSectorValue: number
  largestHolding: { symbol: string; weight: number } | null
  topThreeWeight: number
  hhi: number
  effectivePositions: number
  largestSector: { name: string; weight: number } | null
  sectors: Array<{ name: string; value: number; weight: number }>
}

export function calculatePortfolioConcentration(
  positions: PortfolioConcentrationPosition[],
): PortfolioConcentrationSummary {
  const valuedPositions = positions
    .map((position) => ({
      ...position,
      marketValue: Number.isFinite(position.marketValue) && position.marketValue > 0
        ? position.marketValue
        : 0,
    }))
    .filter((position) => position.marketValue > 0)
  const totalValue = valuedPositions.reduce((sum, position) => sum + position.marketValue, 0)
  const weightedPositions = valuedPositions
    .map((position) => ({
      symbol: position.symbol,
      weight: position.marketValue / totalValue,
    }))
    .sort((left, right) => right.weight - left.weight)
  const hhi = weightedPositions.reduce((sum, position) => sum + position.weight ** 2, 0)
  const resolvedSectorPositions = valuedPositions.filter((position) => Boolean(position.sector))
  const resolvedSectorValue = resolvedSectorPositions.reduce((sum, position) => sum + position.marketValue, 0)
  const unresolvedSectorValue = totalValue - resolvedSectorValue
  const sectorValues = resolvedSectorPositions.reduce<Record<string, number>>((sectors, position) => {
    const sector = position.sector as string
    sectors[sector] = (sectors[sector] || 0) + position.marketValue
    return sectors
  }, {})
  const sectors = Object.entries(sectorValues)
    .map(([name, value]) => ({ name, value, weight: value / resolvedSectorValue }))
    .sort((left, right) => right.value - left.value)

  return {
    totalValue,
    positionCount: positions.length,
    quotedPositionCount: positions.filter((position) => position.hasLiveQuote).length,
    resolvedSectorPositionCount: positions.filter((position) => Boolean(position.sector)).length,
    unresolvedSectorPositionCount: positions.filter((position) => !position.sector).length,
    resolvedSectorValue,
    unresolvedSectorValue,
    largestHolding: weightedPositions[0] ?? null,
    topThreeWeight: weightedPositions.slice(0, 3).reduce((sum, position) => sum + position.weight, 0),
    hhi,
    effectivePositions: hhi > 0 ? 1 / hhi : 0,
    largestSector: sectors[0] ? { name: sectors[0].name, weight: sectors[0].weight } : null,
    sectors,
  }
}
