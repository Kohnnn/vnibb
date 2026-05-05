import {
  buildTradingViewSymbolCandidates,
  normalizeExchange,
  resolveTVSymbol,
  toTradingViewSymbol,
} from '@/lib/tradingView'

describe('tradingView helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('normalizeExchange maps HOSE aliases', () => {
    expect(normalizeExchange('hose')).toBe('HOSE')
    expect(normalizeExchange('hsx')).toBe('HOSE')
    expect(normalizeExchange('hnx')).toBe('HNX')
  })

  test('buildTradingViewSymbolCandidates prioritizes HOSE for HOSE tickers', () => {
    const candidates = buildTradingViewSymbolCandidates('vnm', 'HOSE')
    expect(candidates[0]).toBe('HOSE:VNM')
    expect(candidates).toContain('HSX:VNM')
  })

  test('buildTradingViewSymbolCandidates keeps prefixed symbol as-is', () => {
    expect(buildTradingViewSymbolCandidates('NASDAQ:AAPL')).toEqual(['NASDAQ:AAPL'])
  })

  test('resolveTVSymbol returns first resolved candidate', () => {
    expect(resolveTVSymbol('VCB', 'HOSE')).toBe('HOSE:VCB')
    expect(toTradingViewSymbol('VCB', 'HOSE')).toBe('HOSE:VCB')
  })

  test('persisted mapping is used before generated candidates', () => {
    window.localStorage.setItem('vnibb_tv_symbol_map_v1', JSON.stringify({ VNM: 'UPCOM:VNM' }))
    const candidates = buildTradingViewSymbolCandidates('VNM', 'HOSE')
    expect(candidates[0]).toBe('HOSE:VNM')
    expect(candidates).toContain('UPCOM:VNM')
  })

  test('legacy HSX persisted value gets HOSE candidate first', () => {
    window.localStorage.setItem('vnibb_tv_symbol_map_v1', JSON.stringify({ VNM: 'HSX:VNM' }))
    const candidates = buildTradingViewSymbolCandidates('VNM', 'HOSE')
    expect(candidates[0]).toBe('HOSE:VNM')
    expect(candidates).toContain('HSX:VNM')
  })
})
