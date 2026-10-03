import { render, screen } from '@testing-library/react';
import { ReviewedWorkflowDisclosure } from './ReviewedWorkflowDisclosure';

test('resolves starter requirements by exact reviewed revision without claiming evidence is present', () => {
  render(<ReviewedWorkflowDisclosure workflow={{ id: 'financial-summary', revision: 1 }} symbol="VNM" />);
  expect(screen.getByText(/Scope: symbol · Current symbol: VNM/)).toBeInTheDocument();
  expect(screen.getByText(/Requires: income_statement, balance_sheet, cash_flow, financial_ratios/)).toBeInTheDocument();
  expect(screen.getByText(/Evidence availability is checked by the server/)).toBeInTheDocument();
});

test('stale identity cannot reuse current starter requirements', () => {
  render(<ReviewedWorkflowDisclosure workflow={{ id: 'financial-summary', revision: 2 }} symbol="FPT" />);
  expect(screen.getByText(/Scope: unknown · Current symbol: FPT/)).toBeInTheDocument();
  expect(screen.getByText(/refresh the prompt library/)).toBeInTheDocument();
  expect(screen.queryByText(/Requires: income_statement/)).not.toBeInTheDocument();
});

test('Matrix starter explicitly names missing frozen selection before sending', () => {
  render(<ReviewedWorkflowDisclosure workflow={{ id: 'peer-comparison', revision: 1 }} />);
  expect(screen.getByText(/Missing requirement: attach an authorized frozen Matrix selection/)).toBeInTheDocument();
});
