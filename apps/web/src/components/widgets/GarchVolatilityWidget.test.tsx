import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APIError, type QuantResponse } from '@/lib/api';
import { widgetDefinitions } from '@/data/widgetDefinitions';
import { WIDGET_LAYOUT_BEHAVIORS } from '@/lib/dashboardLayout';
import { useGarchVolatility, type GarchVolatilityState } from '@/lib/queries';
import { GarchVolatilityWidget } from './GarchVolatilityWidget';
import { PolymarketWidget } from './PolymarketWidget';


jest.mock('@/lib/queries', () => ({
  useGarchVolatility: jest.fn(),
}));

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}));

jest.mock('@/lib/widgetRuntime', () => ({
  buildWidgetRuntime: (payload: Record<string, unknown>) => payload,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { readonly message: string }) => <div>{message}</div>,
  WidgetError: ({ error, title }: { readonly error: Error; readonly title?: string }) => (
    <div>{title ? `${title}: ${error.message}` : error.message}</div>
  ),
  WidgetLoading: ({ message }: { readonly message: string }) => <div>{message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: ({ note }: { readonly note?: string }) => <div>{note}</div>,
}));

jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/QuantWarningBanner', () => ({
  QuantWarningBanner: ({ warning }: { readonly warning?: string | null }) => (warning ? <div>{warning}</div> : null),
}));

class JsonTestResponse {
  readonly status: number;
  readonly ok: boolean;

  constructor(private readonly body: string, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.body);
  }
}

Object.defineProperty(globalThis, 'Response', { value: JsonTestResponse, configurable: true });

jest.mock('recharts', () => ({
  Area: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ children }: { readonly children: ReactNode }) => <svg>{children}</svg>,
  Line: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const mockUseGarchVolatility = jest.mocked(useGarchVolatility);
type GarchQueryResult = UseQueryResult<GarchVolatilityState, Error>;

type GarchMetricPayload = {
  readonly omega: number | null;
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly persistence: number | null;
  readonly current_conditional_vol_pct: number | null;
  readonly long_run_vol_pct: number | null;
  readonly note: string;
};

function makeQuantResponse(metric: GarchMetricPayload | null, error: string | null = null): QuantResponse {
  return {
    data: {
      symbol: 'VCB',
      period: '5Y',
      adjustment_mode: 'adjusted',
      computed_at: '2026-06-24T00:00:00Z',
      last_data_date: '2026-06-23',
      metrics: metric ? { garch_volatility: metric } : {},
    },
    meta: { count: metric ? 1 : 0 },
    error,
  };
}

function makeGarchState(response: QuantResponse): GarchVolatilityState {
  return {
    status: 'ok',
    response,
    metric: response.data.metrics.garch_volatility ?? null,
    error: response.error,
  };
}

function mockGarchData(state: GarchVolatilityState): GarchQueryResult {
  let result: GarchQueryResult;
  const refetch: GarchQueryResult['refetch'] = async () => result;
  result = {
    data: state,
    dataUpdatedAt: Date.UTC(2026, 5, 24),
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch,
    status: 'success',
    fetchStatus: 'idle',
    promise: Promise.resolve(state),
  } satisfies GarchQueryResult;
  return result;
}


const garchMetric: GarchMetricPayload = {
  omega: 0.11,
  alpha: 0.22,
  beta: 0.73,
  persistence: 0.95,
  current_conditional_vol_pct: 31.4,
  long_run_vol_pct: 22.8,
  note: 'GARCH(1,1) backend Wave 5.1 model is provisional until deployment completes.',
};

describe('GarchVolatilityWidget', () => {
  beforeEach(() => {
    mockUseGarchVolatility.mockReturnValue(mockGarchData(makeGarchState(makeQuantResponse(garchMetric))));
  });

  it('renders key GARCH payload fields from quant metrics', () => {
    render(<GarchVolatilityWidget symbol="VCB" />);

    expect(screen.getByText(/omega/i)).toBeInTheDocument();
    expect(screen.getByText('0.11')).toBeInTheDocument();
    expect(screen.getByText(/alpha/i)).toBeInTheDocument();
    expect(screen.getByText('0.22')).toBeInTheDocument();
    expect(screen.getByText(/beta/i)).toBeInTheDocument();
    expect(screen.getByText('0.73')).toBeInTheDocument();
    expect(screen.getByText(/persistence/i)).toBeInTheDocument();
    expect(screen.getByText('0.95')).toBeInTheDocument();
    expect(screen.getByText(/conditional vol/i)).toBeInTheDocument();
    expect(screen.getByText(/31\.4(?:0)?%/)).toBeInTheDocument();
    expect(screen.getByText(/long[- ]run vol/i)).toBeInTheDocument();
    expect(screen.getByText(/22\.8(?:0)?%/)).toBeInTheDocument();
    expect(screen.getByText(garchMetric.note)).toBeInTheDocument();
  });

  it('requests garch_volatility when the period selector changes', async () => {
    render(<GarchVolatilityWidget symbol="VCB" />);

    fireEvent.click(screen.getByRole('button', { name: '1Y' }));

    await waitFor(() => {
      expect(mockUseGarchVolatility).toHaveBeenLastCalledWith(
        'VCB',
        expect.objectContaining({
          period: '1Y',
          enabled: true,
        }),
      );
    });
  });

  it('shows a graceful unavailable state for empty data', () => {
    mockUseGarchVolatility.mockReturnValue(
      mockGarchData(makeGarchState(makeQuantResponse(null, 'GARCH volatility is unavailable until Wave 5.1 deploys.'))),
    );

    render(<GarchVolatilityWidget symbol="VCB" />);

    expect(screen.getByText(/garch volatility is unavailable|not deployed|no garch/i)).toBeInTheDocument();
  });

  it('shows a graceful unavailable state for the not-deployed sentinel', () => {
    mockUseGarchVolatility.mockReturnValue(mockGarchData({ status: 'not_deployed' }));

    render(<GarchVolatilityWidget symbol="VCB" />);

    expect(screen.getByText(/garch volatility is unavailable|not deployed/i)).toBeInTheDocument();
  });
});

describe('GARCH volatility widget registration', () => {
  it('is registered in the widget library and layout contract', () => {
    expect(widgetDefinitions.some((definition) => definition.type === 'garch_volatility')).toBe(true);
    expect(WIDGET_LAYOUT_BEHAVIORS).toHaveProperty('garch_volatility');
  });
});

describe('Polymarket widget registration gap', () => {
  it('has polymarket in the layout contract', () => {
    expect(WIDGET_LAYOUT_BEHAVIORS).toHaveProperty('polymarket');
  });

  it('has polymarket registered in widgetDefinitions with category metadata', () => {
    const def = widgetDefinitions.find((definition) => definition.type === 'polymarket');
    expect(def).toBeDefined();
    expect(def?.category).toBeDefined();
  });

  it('renders the polymarket widget empty state from the DB-backed API', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(() =>
      Promise.resolve(new Response(JSON.stringify({ count: 0, data: [] }), { status: 200 })),
    );
    global.fetch = fetchMock;

    render(<PolymarketWidget />);

    expect(await screen.findByText('No Polymarket markets available')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/prediction-markets?source=polymarket&active=true&limit=20'),
      { cache: 'no-store' },
    );
  });
});

// Regression: older backend with /quant route deployed but without
// garch_volatility returns 400 unsupported metric.  Use jest.requireActual
// because @/lib/queries is fully mocked above.
const { isGarchNotDeployedError } = jest.requireActual<typeof import('@/lib/queries')>('@/lib/queries');

describe('isGarchNotDeployedError', () => {
  it('returns true for 404', () => {
    expect(isGarchNotDeployedError(new APIError('Not found', 404, 'Not Found'))).toBe(true);
  });

  it('returns true for 405', () => {
    expect(isGarchNotDeployedError(new APIError('Method not allowed', 405, 'Method Not Allowed'))).toBe(true);
  });

  it('returns true for 400 with unsupported garch_volatility message', () => {
    expect(isGarchNotDeployedError(new APIError('Unsupported metric: garch_volatility', 400, 'Bad Request'))).toBe(true);
  });

  it('returns false for a generic 400 error', () => {
    expect(isGarchNotDeployedError(new APIError('Bad request from server', 400, 'Bad Request'))).toBe(false);
  });

  it('returns false for non-APIError errors', () => {
    expect(isGarchNotDeployedError(new Error('Network error'))).toBe(false);
  });

  it('returns false for server errors (500)', () => {
    expect(isGarchNotDeployedError(new APIError('Internal error', 500, 'Internal Server Error'))).toBe(false);
  });
});
