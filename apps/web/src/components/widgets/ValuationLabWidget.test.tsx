import { fireEvent, render, screen, within } from '@testing-library/react';
import { useTTMSnapshot, useStockQuote } from '@/lib/queries';
import { ValuationLabWidget } from './ValuationLabWidget';

jest.mock('@/lib/queries', () => ({ useTTMSnapshot: jest.fn(), useStockQuote: jest.fn() }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockTtm = useTTMSnapshot as jest.Mock;
const mockStockQuote = useStockQuote as jest.Mock;

describe('ValuationLabWidget price-unit comparison', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTtm.mockReturnValue({
      data: { data: { cash_flow: { free_cash_flow: 1000 } } },
      isLoading: false, error: null, refetch: jest.fn(),
    });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'VND' },
      isLoading: false, error: null, refetch: jest.fn(),
    });
  });

  test.each(['unknown', 'index_points'] as const)(
    'excludes a %s quote from upside and reverse DCF while still reporting it',
    (price_unit) => {
      mockStockQuote.mockReturnValue({
        data: { symbol: 'FPT', price: 57.3, price_unit },
        isLoading: false, error: null, refetch: jest.fn(),
      });
      const onDataChange = jest.fn();
      render(<ValuationLabWidget symbol="FPT" onDataChange={onDataChange} />);
      fireEvent.change(screen.getByLabelText(/Shares outstanding/i), { target: { value: '100' } });

      expect(within(screen.getByText('Current price').parentElement!).getByText('57.30')).toBeInTheDocument();
      expect(within(screen.getByText('Upside').parentElement!).getByText('—')).toBeInTheDocument();
      expect(screen.queryByText(/Reverse DCF/)).not.toBeInTheDocument();
      expect(screen.getByText(/excluded from upside and reverse DCF/)).toBeInTheDocument();

      const payload = onDataChange.mock.calls.at(-1)?.[0];
      expect(payload.result.upsidePct).toBeNull();
      expect(payload.result.impliedGrowth).toBeNull();
      expect(payload.result.currentPrice).toBe(57.3);
      expect(payload.result.priceUnit).toBe(price_unit);
    },
  );

  test('compares an explicitly VND quote against the DCF intrinsic value', () => {
    render(<ValuationLabWidget symbol="FPT" />);
    fireEvent.change(screen.getByLabelText(/Shares outstanding/i), { target: { value: '100' } });

    expect(within(screen.getByText('Current price').parentElement!).getByText('57.30')).toBeInTheDocument();
    const upsideText = within(screen.getByText('Upside').parentElement!).getByText(/%/).textContent ?? '';
    expect(upsideText).not.toBe('—');
    expect(screen.getByText(/Reverse DCF/)).toBeInTheDocument();
    expect(screen.queryByText(/excluded from upside and reverse DCF/)).not.toBeInTheDocument();
  });
});
