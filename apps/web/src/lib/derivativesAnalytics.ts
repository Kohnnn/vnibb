export interface DerivativesContractLike {
  symbol: string
  name: string
  expiry: string
}

export interface DerivativesHistoryPointLike {
  time: string
  close: number
  volume: number
}

export interface DerivativesCurveRow {
  symbol: string
  expiry: string
  daysToExpiry: number | null
  latestClose: number | null
  avgVolume20d: number | null
  return20dPct: number | null
  realizedVol20dPct: number | null
  spreadToFrontPct: number | null
}

export function daysUntilExpiry(expiry: string): number | null {
  const parsed = new Date(expiry)
  if (Number.isNaN(parsed.getTime())) return null
  return Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export function buildDerivativesCurveRows(
  contracts: DerivativesContractLike[],
  historyMap: Record<string, DerivativesHistoryPointLike[]>,
) {
  const sortedContracts = [...contracts].sort((left, right) => {
    const a = new Date(left.expiry).getTime()
    const b = new Date(right.expiry).getTime()
    return a - b
  })

  const frontHistory = sortedContracts[0] ? historyMap[sortedContracts[0].symbol] || [] : []
  const frontClose = frontHistory.length ? frontHistory[frontHistory.length - 1]?.close ?? null : null

  return sortedContracts.map((contract) => {
    const rows = historyMap[contract.symbol] || []
    const latest = rows[rows.length - 1]
    const avgVolume20d = rows.length
      ? rows.slice(-20).reduce((sum, row) => sum + (row.volume || 0), 0) / Math.min(rows.length, 20)
      : null
    const return20dPct = rows.length > 20
      ? ((rows[rows.length - 1].close - rows[rows.length - 21].close) / rows[rows.length - 21].close) * 100
      : null
    const dailyReturns = rows.slice(-21).map((row, index, list) => {
      if (index === 0 || !list[index - 1].close) return null
      return (row.close / list[index - 1].close) - 1
    }).filter((value): value is number => value !== null && Number.isFinite(value))
    const mean = dailyReturns.length ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length : null
    const realizedVol20dPct = mean === null || dailyReturns.length < 2
      ? null
      : Math.sqrt(dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1)) * Math.sqrt(252) * 100

    return {
      symbol: contract.symbol,
      expiry: contract.expiry,
      daysToExpiry: daysUntilExpiry(contract.expiry),
      latestClose: latest?.close ?? null,
      avgVolume20d: avgVolume20d ? Math.round(avgVolume20d) : null,
      return20dPct: return20dPct !== null && Number.isFinite(return20dPct) ? Number(return20dPct.toFixed(2)) : null,
      realizedVol20dPct: realizedVol20dPct !== null && Number.isFinite(realizedVol20dPct) ? Number(realizedVol20dPct.toFixed(2)) : null,
      spreadToFrontPct: frontClose && latest?.close
        ? Number((((latest.close - frontClose) / frontClose) * 100).toFixed(2))
        : null,
    } satisfies DerivativesCurveRow
  })
}

export function classifyDerivativesCurve(rows: DerivativesCurveRow[]): 'contango' | 'backwardation' | 'flat' | 'unknown' {
  const priced = rows.filter((row) => row.latestClose !== null)
  if (priced.length < 2) return 'unknown'
  const front = priced[0].latestClose as number
  const back = priced[priced.length - 1].latestClose as number
  if (back > front * 1.01) return 'contango'
  if (back < front * 0.99) return 'backwardation'
  return 'flat'
}
