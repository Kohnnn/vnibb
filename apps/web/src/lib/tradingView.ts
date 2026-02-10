const RESOLVED_SYMBOLS_STORAGE_KEY = 'vnibb_tv_symbol_map_v1'

function normalizeSymbol(symbol: string): string {
  return symbol?.trim().toUpperCase() || ''
}

export function normalizeExchange(exchange?: string): string | null {
  const raw = exchange?.trim().toUpperCase()
  if (!raw) return null
  if (['HOSE', 'HSX'].includes(raw)) return 'HOSE'
  if (raw === 'HNX') return 'HNX'
  if (['UPCOM', 'UPCO'].includes(raw)) return 'UPCOM'
  return raw
}

function readResolvedSymbolMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(RESOLVED_SYMBOLS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function writeResolvedSymbolMap(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RESOLVED_SYMBOLS_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore storage write failures
  }
}

export function getPersistedTradingViewSymbol(symbol: string): string | null {
  const key = normalizeSymbol(symbol)
  if (!key) return null

  const map = readResolvedSymbolMap()
  const resolved = map[key]
  return resolved ? resolved.toUpperCase() : null
}

export function persistResolvedTradingViewSymbol(symbol: string, resolvedSymbol: string): void {
  const key = normalizeSymbol(symbol)
  const resolved = normalizeSymbol(resolvedSymbol)
  if (!key || !resolved || !resolved.includes(':')) return

  const map = readResolvedSymbolMap()
  map[key] = resolved
  writeResolvedSymbolMap(map)
}

export function buildTradingViewSymbolCandidates(symbol: string, exchange?: string): string[] {
  const normalizedSymbol = normalizeSymbol(symbol)
  if (!normalizedSymbol) return []

  if (normalizedSymbol.includes(':')) return [normalizedSymbol]

  const candidates: string[] = []

  const persisted = getPersistedTradingViewSymbol(normalizedSymbol)
  if (persisted) {
    candidates.push(persisted)
  }

  const normalizedExchange = normalizeExchange(exchange)
  if (normalizedExchange) {
    candidates.push(`${normalizedExchange}:${normalizedSymbol}`)
  }

  // VN-first fallback chain
  for (const exchangeCandidate of ['HOSE', 'HNX', 'UPCOM']) {
    candidates.push(`${exchangeCandidate}:${normalizedSymbol}`)
  }

  // Last-resort symbol-only value for non-VN symbols
  candidates.push(normalizedSymbol)

  return Array.from(new Set(candidates.filter(Boolean)))
}

export function toTradingViewSymbol(symbol: string, exchange?: string): string {
  const candidates = buildTradingViewSymbolCandidates(symbol, exchange)
  return candidates[0] || ''
}
