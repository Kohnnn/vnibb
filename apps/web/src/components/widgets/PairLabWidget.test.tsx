import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { APIError, getPairDiagnostics, type PairDiagnosticsPayload } from '@/lib/api'
import { PairLabWidget } from './PairLabWidget'

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getPairDiagnostics: jest.fn(),
}))

jest.mock('@/lib/queries', () => ({
  ...jest.requireActual('@/lib/queries'),
  useHistoricalPrices: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
}))

jest.mock('@/components/widgets/QuantRunHistoryPanel', () => ({
  QuantRunHistoryPanel: () => null,
}))

const mockGetPairDiagnostics = jest.mocked(getPairDiagnostics)
const payload: PairDiagnosticsPayload = {
  symbol: 'VCB', pair_symbol: 'VNM', period: '3Y', computed_at: '2026-09-01T00:00:00Z',
  aligned_days: 100, hedge_ratio_ols: 1.42, hedge_intercept: 0, adf_tstat: -2.8,
  adf_critical_values: { '5%': -2.9 }, adf_verdict: 'Inconclusive', adf_caveat: 'Approximate',
  half_life_days: 10, rolling_correlation_63d: 0.8, spread_z_score: 0.5,
}

function openOls() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><PairLabWidget symbol="VCB" /></QueryClientProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'Pair symbol' }), { target: { value: 'VNM' } })
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
  fireEvent.click(screen.getByRole('button', { name: 'OLS (backend)' }))
}

describe('PairLabWidget OLS diagnostics', () => {
  beforeEach(() => mockGetPairDiagnostics.mockReset())

  it.each([
    ['HTTP 500', new APIError('Server unavailable', 500)],
    ['timeout', new Error('Request timed out')],
  ])('shows %s failure and retries the diagnostics request', async (_label, failure) => {
    mockGetPairDiagnostics.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
      .mockResolvedValue({ data: payload })
    openOls()

    await waitFor(() => expect(screen.getByText(`OLS diagnostics failed: ${failure.message}`)).toBeInTheDocument(), { timeout: 3500 })
    expect(screen.queryByText('Computing OLS hedge ratio…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }))

    await waitFor(() => expect(screen.getByText('1.42')).toBeInTheDocument())
    expect(mockGetPairDiagnostics).toHaveBeenCalledTimes(3)
  })

  it.each([404, 405])('keeps the not-deployed 1:1 fallback for HTTP %i', async (status) => {
    mockGetPairDiagnostics.mockRejectedValue(new APIError('Unavailable', status))
    openOls()

    expect(await screen.findByText(/backend endpoint hasn.t been deployed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument()
    expect(mockGetPairDiagnostics).toHaveBeenCalledTimes(1)
  })
})
