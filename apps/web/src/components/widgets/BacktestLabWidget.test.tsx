import type { UseQueryResult } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'

import type { QuantBacktestResponse } from '@/lib/api'
import { useQuantBacktest } from '@/lib/queries'
import { BacktestLabWidget } from './BacktestLabWidget'

jest.mock('@/lib/queries', () => ({ useQuantBacktest: jest.fn() }))

const backtestQuery = jest.mocked(useQuantBacktest)
const populated = {
  data: {
    symbol: 'FPT', period: '5Y', adjustment_mode: 'adjusted',
    metrics: { total_return_pct: 5, max_drawdown_pct: -3, sharpe_daily_rf0: 0.8, trade_count: 1 },
    trades: [], warnings: [],
  },
  meta: { unit_status: 'confirmed_vnd' },
  error: null,
}

function response(data: unknown) {
  return {
    data, isLoading: false, isFetching: false, error: null,
    refetch: jest.fn(), dataUpdatedAt: 0,
  } as unknown as UseQueryResult<QuantBacktestResponse, Error>
}

beforeEach(() => backtestQuery.mockReset())

it('keeps invalid setup editable and displays results after correcting the windows', () => {
  backtestQuery.mockReturnValue(response(populated))
  render(<BacktestLabWidget symbol="FPT" />)

  fireEvent.change(screen.getByLabelText('Fast MA'), { target: { value: '50' } })
  expect(screen.getByText('Fast MA must be smaller than slow MA')).toBeInTheDocument()
  expect(screen.getByLabelText('Period')).toBeEnabled()
  expect(screen.getByLabelText('As of')).toBeEnabled()
  expect(screen.getByLabelText('Slow MA')).toBeEnabled()
  expect(screen.queryByText('5%')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Fast MA'), { target: { value: '10' } })
  expect(screen.queryByText('Fast MA must be smaller than slow MA')).not.toBeInTheDocument()
  expect(screen.getByText('5%')).toBeInTheDocument()
})

it('exposes the HTTP 200 unsupported response reason without fabricated results', () => {
  backtestQuery.mockReturnValue(response({ data: null, meta: { unavailable: true }, error: 'Unsupported source for this strategy' }))
  render(<BacktestLabWidget symbol="FPT" />)

  expect(screen.getByText('Unsupported source for this strategy')).toBeInTheDocument()
  expect(screen.queryByText('No backtest data for FPT')).not.toBeInTheDocument()
  expect(screen.queryByText('5%')).not.toBeInTheDocument()
})
