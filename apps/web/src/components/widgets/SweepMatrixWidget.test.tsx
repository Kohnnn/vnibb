import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import type { QuantSweepResponse } from '@/lib/api'
import { useQuantSweep } from '@/lib/queries'
import { SweepMatrixWidget } from './SweepMatrixWidget'

jest.mock('@/lib/queries', () => ({ useQuantSweep: jest.fn() }))

it('exposes the HTTP 200 unsupported sweep reason instead of implying absent history', () => {
  jest.mocked(useQuantSweep).mockReturnValue({
    data: { data: null, meta: { unavailable: true }, error: 'Unsupported source for this sweep' },
    isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
  } as unknown as UseQueryResult<QuantSweepResponse, Error>)
  render(<SweepMatrixWidget symbol="FPT" />)

  expect(screen.getByText('Unsupported source for this sweep')).toBeInTheDocument()
  expect(screen.queryByText('No sweep data for FPT')).not.toBeInTheDocument()
  expect(screen.queryByText(/Best by/)).not.toBeInTheDocument()
})
