import { render, screen } from '@testing-library/react';
import { useHistoricalPrices, useQuantMetrics } from '@/lib/queries';
import { RiskDashboardWidget } from './RiskDashboardWidget';

jest.mock('@/lib/queries', () => ({
  useQuantMetrics: jest.fn(),
  useHistoricalPrices: jest.fn(),
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const quant = jest.mocked(useQuantMetrics);
const history = jest.mocked(useHistoricalPrices);

// The widget withholds everything unless the price units are certified and all
// six metrics are finite, so the fixture has to satisfy that gate to reach the
// Sortino panel at all.
const prices = Array.from({ length: 140 }, (_, index) => ({
  time: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
  close: 20_000 + index * 10,
  price_unit: 'VND',
}));

const meta = { unit_status: 'confirmed_vnd' };

function showSortino(monthly: Record<string, number>) {
  quant.mockReturnValue({
    data: {
      data: {
        metrics: {
          sortino: { monthly_sortino: monthly, best_months: [], avoid_months: [] },
          drawdown_recovery: { max_drawdown_from_52w_high_pct: -12.5 },
          parkinson_volatility: { current_parkinson_vol_30d_pct: 18.2 },
          benchmark_risk: {
            benchmark: 'VNINDEX',
            current_relative_drawdown_pct: -4.1,
            current_tracking_error_30d_pct: 9.4,
            downside_deviation_30d_pct: 11.0,
          },
        },
      },
      meta,
    },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  history.mockReturnValue({
    data: { data: prices, meta },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  render(<RiskDashboardWidget id="risk" symbol="FPT" />);
}

function sortinoValue(): HTMLElement {
  return screen.getByText('Sortino Quality').nextElementSibling as HTMLElement;
}

describe('risk dashboard Sortino tone', () => {
  it('does not paint a negative average Sortino as a gain', () => {
    // Green on a negative risk-adjusted return claims the opposite of the data.
    showSortino({ '2026-01': -0.8, '2026-02': -1.2 });
    const value = sortinoValue();
    expect(value.textContent).toContain('-1.00');
    expect(value.className).not.toContain('--color-positive');
  });

  it('keeps a positive average Sortino in the gain tone', () => {
    showSortino({ '2026-01': 1.4, '2026-02': 0.6 });
    const value = sortinoValue();
    expect(value.textContent).toContain('1.00');
    expect(value.className).toContain('--color-positive');
  });
});
