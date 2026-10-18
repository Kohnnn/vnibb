import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { useFinancialRatios } from '@/lib/queries';
import type { FinancialRatiosResponse } from '@/types/equity';
import { BankMetricsWidget } from './BankMetricsWidget';

jest.mock('@/lib/queries', () => ({ useFinancialRatios: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockUseFinancialRatios = jest.mocked(useFinancialRatios);

function renderRatios(casaRatio: unknown, creditCost: unknown) {
  // Runtime payloads may contain nulls or blanks despite the numeric API field types.
  const result = {
    data: { symbol: 'VCB', count: 1, data: [{ symbol: 'VCB', period: '2025', loan_to_deposit: 0.8,
      casa_ratio: casaRatio, credit_cost: creditCost }] },
    isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
  } as unknown as UseQueryResult<FinancialRatiosResponse, Error>;
  mockUseFinancialRatios.mockReturnValue(result);
  render(<BankMetricsWidget id="bank-1" symbol="VCB" />);
}

describe('BankMetricsWidget missing values', () => {
  it.each([null, undefined, '', ' '])('keeps missing CASA and credit cost %s unavailable', value => {
    renderRatios(value, value);

    const casaRow = screen.getByRole('row', { name: /CASA Ratio/i });
    const creditCostRow = screen.getByRole('row', { name: /Credit Cost/i });
    expect(within(casaRow).getByText('N/A')).toBeInTheDocument();
    expect(within(creditCostRow).getByText('N/A')).toBeInTheDocument();
    expect(within(casaRow).queryByText('0.00%')).not.toBeInTheDocument();
    expect(within(creditCostRow).queryByText('0.00%')).not.toBeInTheDocument();
  });

  it('retains reported zero CASA and credit cost', () => {
    renderRatios(0, 0);

    expect(within(screen.getByRole('row', { name: /CASA Ratio/i })).getByText('0.00%')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Credit Cost/i })).getByText('0.00%')).toBeInTheDocument();
  });
});
