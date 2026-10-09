import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { useMomentumProfile } from '@/lib/queries'
import type { MomentumProfileResponse } from '@/lib/api'
import { MomentumWidget } from './MomentumWidget'

jest.mock('@/lib/queries', () => ({ useMomentumProfile: jest.fn() }))

const momentumQuery = jest.mocked(useMomentumProfile)

// Mirrors the deployed QA01 MSR shape: near -100% returns plus the confident label the
// widget used to render even when the payload was flagged or unavailable.
const collapsedPayload = {
  symbol: 'MSR',
  period: '3Y',
  adjustment_mode: 'adjusted',
  computed_at: '2026-10-07T00:00:00Z',
  last_data_date: '2026-10-07',
  returns_pct: { r1m: -99.86, r3m: -99.84, r6m: -99.86, r12m: -99.7 },
  momentum_score: -4,
  trend_label: 'Strong Downtrend',
  peer_distribution: [],
}

function showMomentum(response: Record<string, unknown>) {
  momentumQuery.mockReturnValue({
    data: response,
    isLoading:false,
    isFetching:false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: Date.parse('2026-10-07T10:00:00Z'),
  } as unknown as UseQueryResult<MomentumProfileResponse, Error>)
  render(<MomentumWidget symbol="MSR" />)
}

describe('MomentumWidget degraded-payload safety', () => {
  const unsafeMetas: Array<[string, Record<string, unknown>]> = [
    ['mixed units', { unit_status: 'mixed' }],
    ['unconfirmed units', { unit_status: 'unconfirmed' }],
    ['unresolved exclusions', { unit_status: 'confirmed_vnd', unresolved_excluded_dates: ['2026-09-21'] }],
    ['unavailable quality', { unit_status: 'confirmed_vnd', quality_status: 'unavailable' }],
    ['explicit unavailable', { unit_status: 'confirmed_vnd', unavailable:true }],
  ]

  it.each(unsafeMetas)('withholds direction and returns for %s', (_reason, meta) => {
    showMomentum({ data: collapsedPayload, meta })

    expect(screen.getByText('Direction not assessed')).toBeInTheDocument()
    expect(screen.queryByText('Strong Downtrend')).not.toBeInTheDocument()
    expect(screen.queryByText('-99.86%')).not.toBeInTheDocument()
  })

  it('marks numeric legacy payloads without structured unit proof unknown', () => {
    showMomentum({ data: collapsedPayload })

    expect(screen.getByText(/Legacy quality unknown/)).toBeInTheDocument()
    expect(screen.getByText('Direction not assessed')).toBeInTheDocument()
    expect(screen.queryByText('-99.84%')).not.toBeInTheDocument()
  })

  it('preserves certified large moves with benign quote, history, and fallback warnings', () => {
    showMomentum({
      data: { ...collapsedPayload, data_quality_note: 'Latest quote appended. Data only available from 2024-01-02.' },
      meta: {
        unit_status: 'confirmed_vnd', completeness_status: 'partial', fallback_used: true,
        warnings: ['Requested history truncated'], excluded_price_unit_dates: ['2025-01-02'],
        unresolved_excluded_dates: [],
      },
    })

    expect(screen.getByText('Strong Downtrend')).toBeInTheDocument()
    expect(screen.getByText('-99.84%')).toBeInTheDocument()
    expect(screen.getByText(/Latest quote appended/)).toBeInTheDocument()
    expect(screen.getByText(/Requested history truncated/)).toBeInTheDocument()
    expect(screen.getByText(/Historical source fallback used/)).toBeInTheDocument()
    expect(screen.queryByText('Direction not assessed')).not.toBeInTheDocument()
  })

  it('withholds the confident direction label when the response carries an error', () => {
    showMomentum({
      data: collapsedPayload,
      error: 'Insufficient historical data for momentum profile.',
    })

    expect(screen.getByText(/Insufficient historical data for momentum profile/)).toBeInTheDocument()
    expect(screen.getByText('Direction not assessed')).toBeInTheDocument()
    expect(screen.queryByText('Strong Downtrend')).not.toBeInTheDocument()
  })

  it('shows the specific response-level reason instead of a generic empty state', () => {
    showMomentum({
      data: {
        symbol: 'MSR',
        period: '3Y',
        computed_at: '2026-10-07T00:00:00Z',
        returns_pct: {},
        momentum_score: 0,
        peer_distribution: [],
      },
      error: 'Insufficient historical data for momentum profile.',
    })

    expect(screen.getByText('Insufficient historical data for momentum profile.')).toBeInTheDocument()
  })

  it('keeps a genuine large unflagged move visible with its direction label', () => {
    showMomentum({
      data: {
        symbol: 'FPT',
        period: '3Y',
        adjustment_mode: 'adjusted',
        computed_at: '2026-10-07T00:00:00Z',
        last_data_date: '2026-10-07',
        returns_pct: { r1m: -18.4, r3m: -21.2, r6m: -24.9, r12m: -30.1 },
        momentum_score: -4,
        trend_label: 'Strong Downtrend',
        peer_distribution: [],
      },
      meta: { unit_status: 'confirmed_vnd' },
    })

    expect(screen.getByText('Strong Downtrend')).toBeInTheDocument()
    expect(screen.queryByText('Direction not assessed')).not.toBeInTheDocument()
  })
})
