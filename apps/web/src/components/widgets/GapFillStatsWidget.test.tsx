import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { useHistoricalPrices } from '@/lib/queries'
import type { EquityHistoricalResponse } from '@/types/equity'
import { GapFillStatsWidget } from './GapFillStatsWidget'

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut:false, resetTimeout: jest.fn() }),
}))

const historicalQuery = jest.mocked(useHistoricalPrices)

// The Sep 21 2026 bar is the deployed QA01 case: a unit-contaminated session that
// produced a +99,900% gap in a range whose units were never resolved.
// Rows carry explicit price_unit markers so the certified cases exercise the same
// row-level proof the widget now requires. `meta.unit_status` alone is a claim about
// the range, not proof that each consumed session was resolved.
const candles = [
  { symbol: 'MSR', time: '2026-09-14', open: 65500, high: 66000, low: 65000, close: 65200, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-15', open: 65300, high: 65500, low: 65000, close: 65100, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-16', open: 65100, high: 65200, low: 64800, close: 64900, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-17', open: 64900, high: 65100, low: 64700, close: 65000, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-18', open: 65000, high: 65200, low: 64800, close: 65100, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-21', open: 65, high: 66, low: 64, close: 65, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-22', open: 65, high: 66, low: 64, close: 65, volume: 1000, price_unit: 'VND' },
  { symbol: 'MSR', time: '2026-09-23', open: 65, high: 66, low: 64, close: 65, volume: 1000, price_unit: 'VND' },
]

function showGapFill(response: Record<string, unknown>, queryError: Error | null = null) {
  historicalQuery.mockReturnValue({
    data: response,
    isLoading:false,
    isFetching:false,
    error: queryError,
    refetch: jest.fn(),
    dataUpdatedAt: Date.parse('2026-10-07T10:00:00Z'),
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>)
  render(<GapFillStatsWidget symbol="MSR" />)
}

describe('GapFillStatsWidget unit safety', () => {
  it('withholds derived gap statistics when the range declares mixed units', () => {
    showGapFill({ data: candles, meta: { count: candles.length, unit_status: 'mixed', freshness_as_of: '2026-09-23' } })

    expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument()
    expect(screen.getByText(/Mixed historical price units/)).toBeInTheDocument()
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/99,900/)).not.toBeInTheDocument()
  })

  it('withholds derived gap statistics when units are unconfirmed', () => {
    showGapFill({ data: candles, meta: { count: candles.length, unit_status: 'unconfirmed' } })

    expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument()
    expect(screen.getByText(/Historical price units unconfirmed/)).toBeInTheDocument()
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
  })

  it('renders gap statistics for a confirmed VND range', () => {
    showGapFill({ data: candles, meta: { count: candles.length, unit_status: 'confirmed_vnd', freshness_as_of: '2026-09-23' } })

    expect(screen.getByText('Fill Rate')).toBeInTheDocument()
    expect(screen.queryByText('Gap statistics withheld')).not.toBeInTheDocument()
  })

  it('withholds derived gaps when the range claims VND but the rows carry no unit proof', () => {
    // Deployed PROD case: meta.unit_status says confirmed_vnd while every historical
    // row omits price_unit, so the derived gaps are unproven and must not render.
    const markerless = candles.map(({ price_unit: _unit, ...row }) => row)
    showGapFill({ data: markerless, meta: { count: markerless.length, unit_status: 'confirmed_vnd' } })

    expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument()
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/99,900/)).not.toBeInTheDocument()
  })

  it('withholds derived gaps when a single consumed row lacks unit proof', () => {
    const partial = candles.map((row, index) => (index === 3 ? { ...row, price_unit: 'unknown' } : row))
    showGapFill({ data: partial, meta: { count: partial.length, unit_status: 'confirmed_vnd' } })

    expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument()
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
  })

  it('keeps refresh-failure fallback and partial coverage distinct in the banner', () => {
    showGapFill(
      { data: candles, meta: { count: candles.length, unit_status: 'confirmed_vnd', completeness_status: 'partial' } },
      new Error('Refresh failed'),
    )

    expect(screen.getByText(/Partial historical coverage/)).toBeInTheDocument()
    expect(screen.getByText(/Latest historical refresh failed/)).toBeInTheDocument()
    expect(screen.getByText('Fill Rate')).toBeInTheDocument()
  })

  it('shows the response-level reason instead of a generic empty state', () => {
    showGapFill({ data: [], error: 'No qualifying VND-certified sessions in the requested window.' })

    expect(screen.getByText('No qualifying VND-certified sessions in the requested window.')).toBeInTheDocument()
  })

  const unsafeMetas: Array<[string, Record<string, unknown>]> = [
    ['unresolved exclusions', { unit_status: 'confirmed_vnd', unresolved_excluded_dates: ['2026-09-21'] }],
    ['unavailable quality', { unit_status: 'confirmed_vnd', quality_status: 'unavailable' }],
    ['explicit unavailable', { unit_status: 'confirmed_vnd', unavailable:true }],
  ]

  it.each(unsafeMetas)('withholds all derived statistics for %s', (_reason, meta) => {
    showGapFill({ data: candles, meta })

    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
    expect(screen.queryByText('-99.90%')).not.toBeInTheDocument()
  })

  it('marks a numeric legacy range without structured unit proof unknown', () => {
    showGapFill({ data: candles, meta: { count: candles.length } })

    expect(screen.getAllByText(/Legacy quality unknown/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
  })

  it('preserves a certified large gap while disclosing benign range warnings', () => {
    // A real corporate-action-scale move in a VND-certified range: +50% overnight
    // gap that fills the next session. Magnitude is never treated as a quality signal.
    const largeMove = [
      { symbol: 'MSR', time: '2026-09-14', open: 19800, high: 20200, low: 19700, close: 20000, volume: 1000, price_unit: 'VND' },
      { symbol: 'MSR', time: '2026-09-15', open: 30000, high: 31500, low: 29900, close: 31000, volume: 1000, price_unit: 'VND' },
      { symbol: 'MSR', time: '2026-09-16', open: 30500, high: 30800, low: 19000, close: 19500, volume: 1000, price_unit: 'VND' },
    ]
    showGapFill({
      data: largeMove,
      meta: {
        unit_status: 'confirmed_vnd', warnings: ['Latest quote appended', 'Requested history truncated'],
        fallback_used:true, excluded_price_unit_dates: ['2025-01-02'], unresolved_excluded_dates: [],
      },
    })

    expect(screen.getByText('Fill Rate')).toBeInTheDocument()
    expect(screen.getByText('+50.00%')).toBeInTheDocument()
    expect(screen.getByText('Filled 1d')).toBeInTheDocument()
    expect(screen.getByText(/Latest quote appended/)).toBeInTheDocument()
    expect(screen.getByText(/Requested history truncated/)).toBeInTheDocument()
    expect(screen.getByText(/Historical source fallback used/)).toBeInTheDocument()
  })
})
