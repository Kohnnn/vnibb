import { render, screen, within } from '@testing-library/react';
import { useFundamentalAnalysis } from '@/lib/queries';
import { FundamentalAnalysisWidget } from './FundamentalAnalysisWidget';

jest.mock('@/lib/queries', () => ({ useFundamentalAnalysis: jest.fn() }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockAnalysis = useFundamentalAnalysis as jest.Mock;

function mockPayload(inputs?: Record<string, unknown>) {
  mockAnalysis.mockReturnValue({
    data: { data: {
      summary: 'Company thesis remains available.',
      valuation: { intrinsic_value: 34289, price: 59700000, margin_of_safety: -100,
        valuation_verdict: 'stretched', valuation_method: 'dcf', inputs },
      competitive_advantage: { moat: 'wide' },
    } },
    isLoading: false, error: null, refetch: jest.fn(), isFetching: false, dataUpdatedAt: 1,
  });
}

describe('FundamentalAnalysisWidget monetary unit quality', () => {
  test('hides legacy unverified comparison but keeps qualitative analysis', () => {
    mockPayload();
    render(<FundamentalAnalysisWidget symbol="VNM" />);
    expect(screen.getByRole('status')).toHaveTextContent('Legacy valuation units are unverified');
    expect(screen.queryByText('34,289')).not.toBeInTheDocument();
    expect(screen.queryByText(/59,700,000/)).not.toBeInTheDocument();
    expect(screen.queryByText('stretched')).not.toBeInTheDocument();
    expect(within(screen.getByText('MoS').parentElement!).getByText('n/a')).toBeInTheDocument();
    expect(screen.getByText('wide')).toBeInTheDocument();
    expect(screen.getByText('Company thesis remains available.')).toBeInTheDocument();
  });

  test('displays the source-specific unavailable reason', () => {
    mockPayload({ unitQuality: 'unknown', comparisonUnavailableReason: 'Share-count unit is unknown.' });
    render(<FundamentalAnalysisWidget symbol="VNM" />);
    expect(screen.getByRole('status')).toHaveTextContent('Share-count unit is unknown.');
    expect(screen.queryByText('-100.0%')).not.toBeInTheDocument();
  });

  test('keeps a verified comparison even when price is far from intrinsic value', () => {
    mockPayload({ unitQuality: 'verified', comparisonUnavailableReason: null });
    render(<FundamentalAnalysisWidget symbol="VNM" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('34,289')).toBeInTheDocument();
    expect(screen.getByText(/59,700,000 VND\/share/)).toBeInTheDocument();
    expect(screen.getByText('-100.0%')).toBeInTheDocument();
    expect(screen.getByText('stretched')).toBeInTheDocument();
  });
});
