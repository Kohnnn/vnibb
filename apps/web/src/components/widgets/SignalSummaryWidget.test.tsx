import { fireEvent, render, screen } from '@testing-library/react'

import { useFullTechnicalAnalysis } from '@/lib/queries'
import type { FullTechnicalAnalysis } from '@/types/technical'
import { SignalSummaryWidget } from './SignalSummaryWidget'

jest.mock('@/lib/queries', () => ({
  useFullTechnicalAnalysis: jest.fn(),
}))

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

const mockUseFullTechnicalAnalysis = jest.mocked(useFullTechnicalAnalysis)

const technicalAnalysis: FullTechnicalAnalysis = {
  symbol: 'FPT',
  timeframe: 'W',
  moving_averages: {
    sma: { sma_50: 100 },
    ema: {},
    signals: { sma_50: 'buy' },
    current_price: 110,
  },
  oscillators: {
    rsi: { value: 58, signal: 'neutral', zone: 'neutral', period: 14 },
    macd: { macd: 1, signal_line: 0.5, histogram: 0.5, signal: 'buy', params: { fast: 12, slow: 26, signal: 9 } },
    stochastic: { k: 60, d: 55, signal: 'neutral', params: { k_period: 14, d_period: 3 } },
  },
  volatility: {
    bollinger_bands: { upper: 120, middle: 110, lower: 100, current_price: 110, percent_b: 0.5, signal: 'neutral', params: { period: 20, std_dev: 2 } },
    adx: { adx: 25, plus_di: 30, minus_di: 20, trend_strength: 'moderate', signal: 'buy' },
    volume: { volume: 2_000_000, volume_ma: 1_000_000, relative_volume: 2, volume_desc: 'above average', signal: 'buy', params: { period: 20 } },
    ichimoku_cloud: null,
  },
  levels: {
    support_resistance: {
      support: [105, 100],
      resistance: [115, 120],
      current_price: 110,
      nearest_support: 105,
      nearest_resistance: 115,
      support_proximity_pct: 4.55,
      resistance_proximity_pct: 4.55,
    },
    fibonacci: { levels: {}, period_high: 120, period_low: 90, current_price: 110, trend: 'up', lookback_days: 200 },
  },
  signals: {
    symbol: 'FPT',
    overall_signal: 'buy',
    buy_count: 2,
    sell_count: 0,
    neutral_count: 1,
    total_indicators: 3,
    indicators: [
      { name: 'SMA 50', value: 100, signal: 'buy' },
      { name: 'RSI (14)', value: 58, signal: 'neutral' },
      { name: 'Volume', value: '2x', signal: 'buy' },
    ],
    trend_strength: 'moderate',
  },
  generated_at: '2026-07-16T00:00:00Z',
}

describe('SignalSummaryWidget', () => {
  beforeEach(() => {
    mockUseFullTechnicalAnalysis.mockReturnValue({
      data: technicalAnalysis,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 1,
    } as unknown as ReturnType<typeof useFullTechnicalAnalysis>)
  })

  it('uses the selected timeframe and explains indicator evidence', () => {
    render(<SignalSummaryWidget symbol="fpt" />)

    expect(mockUseFullTechnicalAnalysis).toHaveBeenLastCalledWith('FPT', expect.objectContaining({ timeframe: 'W' }))

    fireEvent.click(screen.getByRole('button', { name: 'Short' }))
    expect(mockUseFullTechnicalAnalysis).toHaveBeenLastCalledWith('FPT', expect.objectContaining({ timeframe: 'D' }))

    fireEvent.click(screen.getByRole('button', { name: /RSI \(14\)/ }))
    expect(screen.getByText('RSI below 30 is commonly oversold; above 70 is commonly overbought.')).toBeInTheDocument()
    expect(screen.getByText('Observed: 58.00 · Classification: neutral')).toBeInTheDocument()
  })
})
