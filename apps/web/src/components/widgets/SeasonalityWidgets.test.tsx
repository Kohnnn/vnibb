import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { useSeasonalityMatrix } from '@/lib/queries'
import type { SeasonalityMatrixResponse } from '@/lib/api'
import { SeasonalityHeatmapWidget } from './SeasonalityHeatmapWidget'
import { SeasonalitySpiralHeatmapWidget } from './SeasonalitySpiralHeatmapWidget'

jest.mock('@/lib/queries', () => ({ useSeasonalityMatrix: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut:false, resetTimeout: jest.fn() }),
}))

const seasonalityQuery = jest.mocked(useSeasonalityMatrix)

const rows = [
  { row_key: '2024', column: '01', label: '2024-01', start_date: '2024-01-01', return_pct: 1.2 },
  { row_key: '2024', column: '02', label: '2024-02', start_date: '2024-02-01', return_pct: -0.4 },
  { row_key: '2025', column: '01', label: '2025-01', start_date: '2025-01-01', return_pct: 0.8 },
  { row_key: '2025', column: '02', label: '2025-02', start_date: '2025-02-01', return_pct: 0.3 },
]

const baseData = {
  symbol: 'MSR',
  period: '5Y',
  granularity: 'monthly',
  adjustment_mode: 'raw',
  computed_at: '2026-10-07T00:00:00Z',
  last_data_date: '2026-10-07',
  source: 'historical_prices',
  columns: ['01', '02'],
  rows,
  averages: { '01': 1.0, '02': -0.05 },
  best_period: '2024-01',
  worst_period: '2024-02',
  hit_rate_pct: 75,
  current_period: { row_key: '2026', column: '10', label: '2026-10', start_date: '2026-10-01', return_pct: -99.9 },
}

function showSeasonality(
  Widget: typeof SeasonalityHeatmapWidget | typeof SeasonalitySpiralHeatmapWidget,
  data: Record<string, unknown> | undefined,
) {
  seasonalityQuery.mockReturnValue({
    data,
    isLoading:false,
    isFetching:false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: Date.parse('2026-10-07T10:00:00Z'),
  } as unknown as UseQueryResult<SeasonalityMatrixResponse, Error>)
  return render(<Widget symbol="MSR" />)
}

const seasonalityWidgets: Array<[string, typeof SeasonalityHeatmapWidget | typeof SeasonalitySpiralHeatmapWidget]> = [
  ['heatmap', SeasonalityHeatmapWidget],
  ['spiral', SeasonalitySpiralHeatmapWidget],
]

describe.each(seasonalityWidgets)('%s seasonality source quality', (_name, Widget) => {
  const unsafeMetas: Array<[string, Record<string, unknown>]> = [
    ['mixed units', { unit_status: 'mixed' }],
    ['unconfirmed units', { unit_status: 'unconfirmed' }],
    ['unresolved exclusions', { unit_status: 'confirmed_vnd', unresolved_excluded_dates: ['2026-09-21'] }],
    ['unavailable quality', { unit_status: 'confirmed_vnd', quality_status: 'unavailable' }],
    ['explicit unavailable', { unit_status: 'confirmed_vnd', unavailable:true }],
  ]

  it.each(unsafeMetas)('withholds the numeric visualization and summary for %s', (_reason, meta) => {
    const { container } = showSeasonality(Widget, { data: baseData, meta })

    expect(screen.getByText('Seasonality metrics withheld')).toBeInTheDocument()
    expect(screen.queryByText('2024-01')).not.toBeInTheDocument()
    expect(screen.queryByText('+75.0%')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Average 01: +1.0%')).not.toBeInTheDocument()
    expect(container.querySelector('svg path[fill]')).toBeNull()
  })

  it('withholds legacy numeric payloads without structured unit proof', () => {
    const { container } = showSeasonality(Widget, { data: baseData })

    expect(screen.getAllByText(/Legacy quality unknown/).length).toBeGreaterThan(0)
    expect(screen.getByText('Seasonality metrics withheld')).toBeInTheDocument()
    expect(container.querySelector('svg path[fill]')).toBeNull()
    expect(screen.queryByTitle('Average 01: +1.0%')).not.toBeInTheDocument()
  })

  it('withholds a response-level error even with certified units', () => {
    const { container } = showSeasonality(Widget, {
      data: baseData, meta: { unit_status: 'confirmed_vnd' }, error: 'Insufficient certified history.',
    })

    expect(screen.getByText('Seasonality metrics withheld')).toBeInTheDocument()
    expect(screen.getAllByText(/Insufficient certified history/).length).toBeGreaterThan(0)
    expect(container.querySelector('svg path[fill]')).toBeNull()
    expect(screen.queryByText('+75.0%')).not.toBeInTheDocument()
  })

  it('preserves certified large returns and surfaces every benign warning', () => {
    const { container } = showSeasonality(Widget, {
      data: {
        ...baseData, rows: [{ ...rows[0], return_pct: -99.9 }, ...rows.slice(1)],
        warning: 'Latest quote appended. Data only available from 2024-01-02.',
        data_quality_note: 'Latest price data is from 2026-09-21.',
      },
      meta: {
        unit_status: 'confirmed_vnd', completeness_status: 'partial', fallback_used: true,
        warnings: ['Requested history truncated'], excluded_price_unit_dates: ['2025-01-02'],
        unresolved_excluded_dates: [],
      },
    })

    expect(screen.getByText(/Latest quote appended/)).toBeInTheDocument()
    expect(screen.getByText(/Latest price data is from/)).toBeInTheDocument()
    expect(screen.getByText(/Requested history truncated/)).toBeInTheDocument()
    expect(screen.getByText(/Historical source fallback used/)).toBeInTheDocument()
    expect(screen.queryByText('Seasonality metrics withheld')).not.toBeInTheDocument()
    if (Widget === SeasonalityHeatmapWidget) {
      expect(screen.getByText('+75.0%')).toBeInTheDocument()
      expect(screen.getByText(/2026-10 -99\.9%/)).toBeInTheDocument()
      expect(screen.getByText('-99.9')).toBeInTheDocument()
    } else {
      expect(container.querySelector('svg path[fill]')).not.toBeNull()
      const titles = Array.from(container.querySelectorAll('svg path title'), (node) => node.textContent ?? '')
      expect(titles.some((title) => title.includes('-99.9%'))).toBe(true)
    }
  })

  it('renders certified clean data without a quality banner', () => {
    showSeasonality(Widget, { data: baseData, meta: { unit_status: 'confirmed_vnd' } })

    expect(screen.queryByText(/Legacy quality unknown/)).not.toBeInTheDocument()
    expect(screen.queryByText(/metrics withheld/)).not.toBeInTheDocument()
  })
})
describe('seasonality display semantics', () => {
  it.each(seasonalityWidgets)('%s renders near-zero returns without a negative sign', (_name, Widget) => {
    const nearZeroData = {
      ...baseData,
      rows: [{ ...rows[1], return_pct: -0.04 }],
      averages: { '02': -0.04 },
      current_period: { ...baseData.current_period, return_pct: -0.04 },
    }
    const { container } = showSeasonality(Widget, { data: nearZeroData, meta: { unit_status: 'confirmed_vnd' } })

    expect(container.textContent).not.toContain('-0.0')
    if (Widget === SeasonalitySpiralHeatmapWidget) {
      expect(container.querySelector('svg path title')?.textContent).toContain('0.0%')
      // The fill must agree with the printed digits: -0.04 at 1dp is flat, so it
      // takes the neutral flat swatch rather than a loss tint.
      const nearZeroPath = Array.from(container.querySelectorAll('svg path')).find(
        (el) => el.querySelector('title')?.textContent?.includes('0.0%'),
      )
      expect(nearZeroPath?.getAttribute('fill')).toContain('--text-muted')
      expect(nearZeroPath?.getAttribute('fill')).not.toContain('--color-negative')
    } else {
      // Month cells carry `"<row> <column>: <pct>"`; the February 2024 cell must
      // read 0.0% and use the neutral flat fill, not a loss tint.
      const cell = container.querySelector('[title="2024 02: 0.0%"]')
      expect(cell).toHaveClass('bg-[var(--bg-tertiary)]')
    }
  })

  it('labels flat and missing spiral cells separately', () => {
    const { container } = showSeasonality(SeasonalitySpiralHeatmapWidget, {
      data: baseData,
      meta: { unit_status: 'confirmed_vnd' },
    })

    // Legend labels are sibling text nodes inside one flex row, so match the
    // row rather than each label element.
    const legend = Array.from(container.querySelectorAll('div')).find(
      (el) => /flat\b[\s\S]*missing/.test(el.textContent ?? '') && el.children.length > 0,
    )
    expect(legend?.textContent).toContain('flat')
    expect(legend?.textContent).toContain('missing')
  })
})
