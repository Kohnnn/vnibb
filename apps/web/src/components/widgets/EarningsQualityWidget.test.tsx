import { render, screen } from '@testing-library/react';
import { useEarningsQuality } from '@/lib/queries';
import { EarningsQualityWidget } from './EarningsQualityWidget';

jest.mock('@/lib/queries', () => ({ useEarningsQuality: jest.fn() }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({
    globalSymbol: 'HPG',
    setGlobalSymbol: jest.fn(),
    linkedWidgets: new Set<string>(),
    toggleWidgetLink: jest.fn(),
    isWidgetLinked: () => false,
  }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ globalSymbol: 'HPG', setGlobalSymbol: jest.fn() }),
}));

const quality = jest.mocked(useEarningsQuality);

function reply(data: object | undefined, error: string | null = null) {
  quality.mockReturnValue({
    data,
    error,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  return render(<EarningsQualityWidget symbol="HPG" />);
}

describe('earnings quality unavailable coverage', () => {
  it('states the coverage reason instead of grading unknown inputs', () => {
    // Issue #257: no admitted quarter is a coverage gap, not a passing grade.
    reply(
      { data: { grade: null, quality_score: null, trend: null, checks: [], coverage: { status: 'unavailable', unavailable_reason: 'Insufficient admitted quarterly statement coverage for earnings quality.' } } },
    );

    expect(screen.getByText(/Earnings quality unavailable/).textContent).toContain(
      'Insufficient admitted quarterly statement coverage',
    );
    // The banner keeps its label but carries no ordinal grade letter.
    expect(screen.queryByText(/^[A-D]$/)).toBeNull();
    expect(screen.queryByText(/Stable/)).toBeNull();
    expect(screen.queryByText(/^A$/)).toBeNull();
  });

  it('renders a grade when coverage is admitted', () => {
    reply({
      data: {
        grade: 'B', quality_score: 72, trend: 'Improving', checks: ['Accruals within range'],
        revenue_quality_pct: 108, accruals_ratio_pct: -3, earnings_persistence: 0.8,
        coverage: { status: 'partial' },
      },
    });

    expect(screen.getByText('Quality Grade')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Improving')).toBeInTheDocument();
  });

  it('shows admitted ratios without grading a partial scorecard', () => {
    // #257: one usable ratio is an observation, not a grade and not "no data".
    reply({
      data: {
        grade: null, quality_score: null, trend: null, checks: [],
        accruals_ratio_pct: -3.25, revenue_quality_pct: null, earnings_persistence: null,
        coverage: {
          status: 'partial',
          unavailable_reason: 'Incomplete admitted inputs for a full earnings-quality scorecard; individual admitted ratios are reported without a grade.',
          required_components: { accruals: true, revenue_quality: false },
        },
      },
    });

    expect(screen.getByTestId('quality-partial')).toBeInTheDocument();
    // Both the grade banner and the trend say so; neither invents a label.
    expect(screen.getAllByText('Not graded').length).toBe(2);
    expect(screen.getByText('-3.25%')).toBeInTheDocument();
    // Unreported components stay blank, not zero.
    expect(screen.getAllByText('n/a', { selector: 'div.font-mono' }).length).toBe(2);
    // The banner keeps its label but carries no ordinal grade letter.
    expect(screen.queryByText(/^[A-D]$/)).toBeNull();
    expect(screen.queryByText(/Stable/)).toBeNull();
    expect(screen.queryByText(/No quality conditions met/)).toBeNull();
  });
});
