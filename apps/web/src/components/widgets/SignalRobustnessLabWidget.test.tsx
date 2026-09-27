import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { useScreenerData } from '@/lib/queries'
import { SignalRobustnessLabWidget } from './SignalRobustnessLabWidget'

jest.mock('@/lib/queries', () => ({ useScreenerData: jest.fn() }))
jest.mock('./QuantRunHistoryPanel', () => ({ QuantRunHistoryPanel: () => null }))

const screenerQuery = jest.mocked(useScreenerData)

it('uses supported screener fields and excludes missing metrics and returns from the descriptive read', () => {
  screenerQuery.mockReturnValue({
    data: {
      data: [
        { ticker: 'MISSING', pe: null, perf_1m: null },
        { ticker: 'EMPTY', pe: '', perf_1m: '' },
        { ticker: 'BOOLEAN', pe: false, perf_1m: false },
        { ticker: 'HIGH', pe: 30, perf_1m: -10 },
        { ticker: 'NOPERF', pe: 10, perf_1m: null },
        { ticker: 'ZERO', pe: 10, perf_1m: 0 },
        { ticker: 'GAIN', pe: 10, perf_1m: 10 },
      ],
      meta: {},
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  } as never)

  const onDataChange = jest.fn()
  render(<SignalRobustnessLabWidget onDataChange={onDataChange} />)

  expect(screen.getAllByRole('combobox')[0]).toHaveValue('pe')
  expect(screen.getByText('Universe').parentElement).toHaveTextContent('4')
  expect(screen.getByText('Pass').parentElement).toHaveTextContent('3')
  expect(screen.getByText('Avg return: passing vs universe').parentElement).toHaveTextContent('5.0%')
  expect(screen.getByText('Avg return: passing vs universe').parentElement).toHaveTextContent('+5.0% edge')
  expect(screen.queryByText('3M')).not.toBeInTheDocument()
  expect(screen.queryByText('6M')).not.toBeInTheDocument()
  expect(within(screen.getByText('NOPERF').closest('tr')!).getByText('—')).toBeInTheDocument()
  expect(within(screen.getByText('ZERO').closest('tr')!).getByText('0.0%')).toBeInTheDocument()
  expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
    return_reads: [{ label: '1M', passAvg: 5, universeAvg: 0, edge: 5 }],
  }))
})
