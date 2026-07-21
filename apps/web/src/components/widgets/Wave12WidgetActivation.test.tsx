import { render, screen } from '@testing-library/react';
import { useCashFlow, useFinancialRatios, useFullTechnicalAnalysis, useRatioHistory } from '@/lib/queries';
import { BankMetricsWidget } from './BankMetricsWidget';
import { ValuationBandWidget } from './ValuationBandWidget';
import { CashflowWaterfallWidget } from './CashflowWaterfallWidget';
import { TechnicalSummaryWidget } from './TechnicalSummaryWidget';

jest.mock('@/lib/queries', () => ({
  useCashFlow: jest.fn(),
  useFinancialRatios: jest.fn(),
  useFullTechnicalAnalysis: jest.fn(),
  useRatioHistory: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message, detail }: { message: string; detail?: string }) => <div>{message}{detail ? ` ${detail}` : ''}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: ({ note, sourceLabel }: { note?: string; sourceLabel?: string }) => <div><span>{note}</span><span>{sourceLabel}</span></div>,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div>Loading</div>,
}));

jest.mock('@/components/ui/DenseFinancialTable', () => ({
  DenseFinancialTable: () => <div>Table</div>,
}));

jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/widgets/charts/CashFlowWaterfallChart', () => ({
  CashFlowWaterfallChart: () => <div>Waterfall</div>,
}));

jest.mock('@/components/ui/PeriodToggle', () => ({
  PeriodToggle: () => <div>Period</div>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}));

jest.mock('@/hooks/usePeriodState', () => ({
  usePeriodState: () => ({ period: 'FY', setPeriod: jest.fn() }),
}));

jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({ config: { unit: 'VND' } }),
}));

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: { widgetControlChanged: 'widgetControlChanged' },
  captureAnalyticsEvent: jest.fn(),
}));

jest.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const mockUseCashFlow = useCashFlow as jest.MockedFunction<typeof useCashFlow>;
const mockUseFinancialRatios = useFinancialRatios as jest.MockedFunction<typeof useFinancialRatios>;
const mockUseFullTechnicalAnalysis = useFullTechnicalAnalysis as jest.MockedFunction<typeof useFullTechnicalAnalysis>;
const mockUseRatioHistory = useRatioHistory as jest.MockedFunction<typeof useRatioHistory>;

function query(data: unknown) {
  return { data, isLoading: false, error: null, refetch: jest.fn(), isFetching: false, dataUpdatedAt: 0 } as any;
}

describe('Wave 12 widget truth states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCashFlow.mockReturnValue(query(undefined));
    mockUseFinancialRatios.mockReturnValue(query(undefined));
    mockUseFullTechnicalAnalysis.mockReturnValue(query(undefined));
    mockUseRatioHistory.mockReturnValue(query(undefined));
  });

  it('does not treat general ratios as bank metrics', () => {
    mockUseFinancialRatios.mockReturnValue(query({ data: [{ period: '2024', pe: 12, roe: 0.15 }] }));

    render(<BankMetricsWidget id="bank-1" symbol="FPT" />);

    expect(screen.getByText(/no reported bank-specific metrics/i)).toBeInTheDocument();
  });

  it('rejects sparse, non-positive valuation observations', () => {
    mockUseRatioHistory.mockReturnValue(query({
      data: [
        { period: '2022', pe: -3 },
        { period: '2023', pe: Number.NaN },
        { period: '2024', pe: 12 },
      ],
    }));

    render(<ValuationBandWidget id="valuation-1" symbol="FPT" />);

    expect(screen.getByText(/not enough ratio history/i)).toBeInTheDocument();
    expect(mockUseRatioHistory).toHaveBeenCalledWith('FPT', expect.objectContaining({
      ratios: ['pe', 'pb', 'ps', 'ev_ebitda', 'ev_sales'],
      period: 'year',
      limit: 60,
    }));
  });

  it('does not infer a cash bridge when a reported top-level line is missing', () => {
    mockUseCashFlow.mockReturnValue(query({
      data: [{ period: '2024', operating_cash_flow: 10, investing_cash_flow: -4, net_change_in_cash: 3 }],
    }));

    render(<CashflowWaterfallWidget id="cash-1" symbol="FPT" />);

    expect(screen.getByText(/missing lines are not inferred/i)).toBeInTheDocument();
  });

  it('keeps technical data-quality, timeframe, source, and non-advice disclosures', () => {
    mockUseFullTechnicalAnalysis.mockReturnValue(query({
      symbol: 'FPT',
      timeframe: 'D',
      moving_averages: { sma: { sma20: Number.NaN }, ema: {}, signals: { sma20: 'neutral' }, current_price: null },
      oscillators: {
        rsi: { value: Number.NaN, signal: 'neutral', zone: 'neutral', period: 14 },
        macd: { macd: null, signal_line: null, histogram: Number.POSITIVE_INFINITY, signal: 'neutral', params: { fast: 12, slow: 26, signal: 9 } },
        stochastic: { k: null, d: null, signal: 'neutral', params: { k_period: 14, d_period: 3 } },
      },
      volatility: { bollinger_bands: {}, adx: {}, volume: null, ichimoku_cloud: null },
      levels: { support_resistance: {}, fibonacci: { levels: { '0.5': Number.NaN } } },
      signals: { overall_signal: 'neutral', buy_count: Number.NaN, neutral_count: 2, sell_count: Number.POSITIVE_INFINITY, total_indicators: 2, indicators: [], trend_strength: 'weak' },
      data_quality: { status: 'degraded', bars: 42, issues: ['Sparse history'] },
      generated_at: '2026-01-01T00:00:00Z',
    } as any));

    render(<TechnicalSummaryWidget id="technical-1" symbol="FPT" />);

    expect(screen.getByText(/Daily · 42 bars · degraded · aggregated indicators, not advice/i)).toBeInTheDocument();
    expect(screen.getByText('VNIBB technical analysis')).toBeInTheDocument();
    expect(screen.getByText('Sparse history')).toBeInTheDocument();
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
    expect(mockUseFullTechnicalAnalysis).toHaveBeenCalledWith('FPT', { timeframe: 'D' });
  });
});
