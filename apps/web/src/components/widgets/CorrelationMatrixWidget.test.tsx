import { render, screen, waitFor } from '@testing-library/react'

import { CorrelationMatrixWidget } from './CorrelationMatrixWidget'
import { useCorrelationMatrix } from '@/lib/queries'

jest.mock('@/lib/queries', () => ({
  useCorrelationMatrix: jest.fn(),
}))

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}))

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div>Loading</div>,
}))

jest.mock('@/components/ui/widget-states', () => ({
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
  WidgetEmpty: ({ message, detail }: { message: string; detail?: string }) => <div>{message}{detail}</div>,
}))

const mockUseCorrelationMatrix = useCorrelationMatrix as jest.MockedFunction<typeof useCorrelationMatrix>
const query = {
  isLoading: false,
  error: null,
  refetch: jest.fn(),
  isFetching: false,
  dataUpdatedAt: 0,
}

describe('CorrelationMatrixWidget', () => {
  beforeEach(() => {
    mockUseCorrelationMatrix.mockReset()
  })

  it('publishes the equity correlation endpoint without a browser-local marker', async () => {
    mockUseCorrelationMatrix.mockReturnValue({
      ...query,
      data: {
        data: {
          symbol: 'VCI',
          days: 60,
          symbols: ['VCI', 'SSI'],
          matrix: [
            { x: 'VCI', y: 'VCI', value: 1 },
            { x: 'VCI', y: 'SSI', value: 0.7 },
            { x: 'SSI', y: 'VCI', value: 0.7 },
            { x: 'SSI', y: 'SSI', value: 1 },
          ],
          returns_count: 5,
        },
        meta: { last_data_date: '2020-01-01' },
      },
    } as unknown as ReturnType<typeof useCorrelationMatrix>)
    const onDataChange = jest.fn()

    render(<CorrelationMatrixWidget id="correlation" symbol="VCI" onDataChange={onDataChange} />)

    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
    const runtime = onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime
    expect(runtime.provenance).toMatchObject({
      apiGroup: '/equity',
      endpoint: '/api/v1/equity/VCI/correlation-matrix',
      sourceLabel: 'VNIBB correlation matrix',
      stale: true,
    })
    expect(runtime.provenance.localOnly).toBeUndefined()
    expect(screen.getByText(/Stale data:/)).toBeInTheDocument()
    expect(screen.getByText(/Partial window:/)).toBeInTheDocument()
    expect(screen.getByText('Anchor latest date: 2020-01-01')).toBeInTheDocument()
    expect(screen.getByText('Anchor observations: 5 · Window 60 trading days')).toBeInTheDocument()
    expect(screen.getByText('— overlapping returns')).toBeInTheDocument()
    expect(screen.queryByText('0 overlapping returns')).not.toBeInTheDocument()
    expect(screen.queryByText(/aligned peer coverage/i)).not.toBeInTheDocument()
  })

  it('renders an explicit zero overlap count', () => {
    mockUseCorrelationMatrix.mockReturnValue({
      ...query,
      data: {
        data: {
          symbol: 'VCI',
          days: 60,
          symbols: ['VCI', 'SSI'],
          matrix: [
            { x: 'VCI', y: 'VCI', value: 1 },
            { x: 'VCI', y: 'SSI', value: 0.7 },
            { x: 'SSI', y: 'VCI', value: 0.7 },
            { x: 'SSI', y: 'SSI', value: 1 },
          ],
          overlap_counts: { 'VCI:SSI': 0 },
          returns_count: 5,
        },
        meta: {},
      },
    } as unknown as ReturnType<typeof useCorrelationMatrix>)

    render(<CorrelationMatrixWidget id="correlation" symbol="VCI" />)

    expect(screen.getByText('0 overlapping returns')).toBeInTheDocument()
    expect(screen.queryByText('— overlapping returns')).not.toBeInTheDocument()
  })

  it('shows the empty coverage disclosure when the API has no matrix', () => {
    mockUseCorrelationMatrix.mockReturnValue({
      ...query,
      data: {
        data: { symbol: 'VCI', days: 60, symbols: ['VCI'], matrix: [], returns_count: 0 },
        meta: {},
      },
    } as unknown as ReturnType<typeof useCorrelationMatrix>)

    render(<CorrelationMatrixWidget id="correlation" symbol="VCI" />)

    expect(screen.getByText(/No peer correlation data available for VCI/)).toBeInTheDocument()
    expect(screen.getByText(/No overlapping daily price history found/)).toBeInTheDocument()
  })
})
