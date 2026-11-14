import { render, screen } from '@testing-library/react';
import { useGrowthRates } from '@/lib/queries';
import { GrowthBridgeWidget } from './GrowthBridgeWidget';

jest.mock('@/lib/queries', () => ({ useGrowthRates: jest.fn() }));
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

const growth = jest.mocked(useGrowthRates);

function reply(data: object) {
  growth.mockReturnValue({
    data: { data },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  return render(<GrowthBridgeWidget id="growth" symbol="HPG" />);
}

const detail = (value: number | null, reason: string | null = null) => ({
  value,
  current: value === null ? null : 200,
  previous: value === null ? null : 100,
  transition: null,
  unavailable_reason: reason,
  basis_status: reason ? 'unconfirmed' : 'confirmed',
  source: 'vietcap',
  currency: 'VND',
  value_unit: 'VND',
  consolidation_basis: 'consolidated',
  flow_basis: 'annual',
  growth_convention: 'absolute_prior_denominator',
});

describe('growth bridge withholds an unadmitted basis', () => {
  it('shows the reason rather than formatting a rate from unknown units', () => {
    // Issue #246: a rate whose basis is unconfirmed is not a figure to format.
    reply({
      as_of: { annual: '2025', quarter: 'Q4-2025' },
      yoy: { revenue_growth: null, earnings_growth: 10, eps_growth: null, ebitda_growth: null, asset_growth: null },
      qoq: { revenue_growth: null, earnings_growth: null, eps_growth: null, ebitda_growth: null },
      comparisons: {
        yoy: {
          revenue_growth: detail(null, 'unverified_statement_currency_or_unit'),
          earnings_growth: detail(10),
          eps_growth: detail(null, 'unverified_statement_currency_or_unit'),
          ebitda_growth: detail(null, 'unverified_statement_currency_or_unit'),
          asset_growth: detail(null, 'unverified_statement_currency_or_unit'),
        },
        qoq: {
          revenue_growth: detail(null, 'unverified_statement_currency_or_unit'),
          earnings_growth: detail(null, 'unverified_statement_currency_or_unit'),
          eps_growth: detail(null, 'unverified_statement_currency_or_unit'),
          ebitda_growth: detail(null, 'unverified_statement_currency_or_unit'),
        },
      },
    });

    expect(screen.getAllByText(/unverified statement currency or unit/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\+?50\.0%$/)).toBeNull();
  });

  it('names the reasons when every rate is withheld', () => {
    // F5: an all-unavailable payload must not fall back to the generic
    // history-coverage empty state and hide the admission reasons (#246).
    reply({
      as_of: { annual: '2025', quarter: 'Q4-2025' },
      yoy: { revenue_growth: null, earnings_growth: null, eps_growth: null, ebitda_growth: null, asset_growth: null },
      qoq: { revenue_growth: null, earnings_growth: null, eps_growth: null, ebitda_growth: null },
      comparisons: {
        yoy: Object.fromEntries(['revenue_growth', 'earnings_growth', 'eps_growth', 'ebitda_growth', 'asset_growth']
          .map((key) => [key, detail(null, 'unverified_statement_currency_or_unit')])),
        qoq: Object.fromEntries(['revenue_growth', 'earnings_growth', 'eps_growth', 'ebitda_growth']
          .map((key) => [key, detail(null, 'incompatible_reporting_basis')])),
      },
    });

    expect(screen.getByTestId('growth-withheld')).toBeInTheDocument();
    expect(screen.getAllByText(/unverified statement currency or unit/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/reporting basis differs between periods/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No growth bridge/)).toBeNull();
  });

  it('renders a confirmed rate and keeps a zero base distinct', () => {
    reply({
      as_of: { annual: '2025', quarter: 'Q4-2025' },
      yoy: { revenue_growth: 100, earnings_growth: null, eps_growth: null, ebitda_growth: null, asset_growth: null },
      qoq: {},
      comparisons: {
        yoy: {
          revenue_growth: detail(100),
          earnings_growth: detail(null, 'zero_base'),
          eps_growth: detail(null, 'missing_comparison_period'),
          ebitda_growth: detail(null, 'missing_comparison_period'),
          asset_growth: detail(null, 'missing_comparison_period'),
        },
        qoq: {},
      },
    });

    expect(screen.getByText(/\+?100\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/prior period was zero/)).toBeInTheDocument();
  });
});
