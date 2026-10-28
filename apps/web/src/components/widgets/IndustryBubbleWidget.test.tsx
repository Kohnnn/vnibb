import { render, screen } from '@testing-library/react';

import { useIndustryBubble } from '@/lib/queries';
import { IndustryBubbleWidget } from './IndustryBubbleWidget';

jest.mock('@/lib/queries', () => ({ useIndustryBubble: jest.fn() }));

jest.mock('recharts', () => ({
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  ScatterChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ZAxis: () => null,
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/widget-skeleton', () => ({ WidgetSkeleton: () => <div /> }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error, title }: { error: Error; title?: string }) => (
    <div>{title || error.message}</div>
  ),
}));

const mockUseIndustryBubble = useIndustryBubble as jest.Mock;

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: { data:[] },
    isLoading:false,
    isFetching:false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: 0,
    ...overrides,
  };
}

describe('IndustryBubbleWidget empty and unavailable states (issue #107)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders a named unavailable state instead of a blank body on error', () => {
    mockUseIndustryBubble.mockReturnValue(query({ error: new Error('404 Not Found') }));

    render(<IndustryBubbleWidget id="bubble-1" symbol="MSR" />);

    expect(screen.getByText('Industry bubble unavailable')).toBeInTheDocument();
  });

  test('explains a missing sector classification instead of showing an empty chart', () => {
    mockUseIndustryBubble.mockReturnValue(query({ data: { data: [], sector: null } }));

    render(<IndustryBubbleWidget id="bubble-1" symbol="MSR" />);

    expect(screen.getByText(/No comparable sector peers for MSR/)).toBeInTheDocument();
    expect(screen.getByText(/no sector classification is available for this symbol/)).toBeInTheDocument();
  });

  test('renders the axis controls and the reference point for a usable sector point', () => {
    mockUseIndustryBubble.mockReturnValue(query({
      data: {
        sector: 'Materials',
        sector_average: { x: 1.2, y: 11 },
        data: [
          { symbol: 'MSR', name: 'Masan Resources', x: 1.2, y: 11, size: 100, color: '#fff', is_reference:true },
        ],
      },
    }));

    render(<IndustryBubbleWidget id="bubble-1" symbol="MSR" />);

    // Usable point: the reference panel renders and the empty state is gone.
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(screen.queryByText(/No comparable sector peers/)).not.toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByText('Y')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
  });
});
