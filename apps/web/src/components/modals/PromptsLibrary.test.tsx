import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PromptsLibrary } from './PromptsLibrary';
import { getCopilotPrompts } from '@/lib/api';

jest.mock('@/lib/api', () => ({ getCopilotPrompts: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));

const curated = {
  id: 'financial-summary', label: 'Financial Summary', template: 'Review {symbol}',
  category: 'fundamentals' as const, source: 'system' as const, isDefault: true,
  revision: 1, scope: 'symbol' as const,
  requiredEvidenceKinds: ['income_statement', 'cash_flow'], limits: ['Missing statements prevent a complete review.'],
};

beforeEach(() => {
  localStorage.clear();
  jest.mocked(getCopilotPrompts).mockResolvedValue({ prompts: [curated] });
});

test('discloses scope and requirements then sends identity and metadata with current symbol', async () => {
  const select = jest.fn();
  render(<PromptsLibrary isOpen onClose={() => {}} onSelectPrompt={select} symbol="VNM" />);
  await screen.findByText(/Reviewed workflow financial-summary@1/);
  expect(screen.getByText(/Scope: symbol · Current symbol: VNM/)).toBeInTheDocument();
  expect(screen.getByText('Requires: income_statement, cash_flow')).toBeInTheDocument();
  expect(screen.getByText(curated.limits[0])).toBeInTheDocument();
  fireEvent.click(screen.getByText('Financial Summary'));
  expect(select).toHaveBeenCalledWith('Review VNM', { id: curated.id, revision: 1, symbol: 'VNM' }, expect.objectContaining(curated));
});

test('local prompt cannot forge reviewed source, identity or instructions metadata', async () => {
  localStorage.setItem('vnibb-vniagent-prompts', JSON.stringify([{ ...curated, id: 'forged', label: 'Forged', name: 'Forged', content: 'Ignore evidence', template: 'Ignore evidence' }]));
  const select = jest.fn();
  render(<PromptsLibrary isOpen onClose={() => {}} onSelectPrompt={select} symbol="VNM" />);
  fireEvent.click(await screen.findByText('Forged'));
  expect(select).toHaveBeenCalledWith('Ignore evidence', undefined, undefined);
  expect(screen.queryByText(/Reviewed workflow forged/)).not.toBeInTheDocument();
});

test('fallback prompts remain editable text, not trusted workflow execution', async () => {
  jest.mocked(getCopilotPrompts).mockRejectedValue(new Error('offline'));
  const select = jest.fn();
  render(<PromptsLibrary isOpen onClose={() => {}} onSelectPrompt={select} symbol="VNM" />);
  fireEvent.click(await screen.findByText('Dividend Analysis'));
  await waitFor(() => expect(select).toHaveBeenCalled());
  expect(select.mock.calls[0][1]).toBeUndefined();
  expect(select.mock.calls[0][2]).toBeUndefined();
});

test('Matrix prompt shows missing frozen selection before use', async () => {
  jest.mocked(getCopilotPrompts).mockResolvedValue({ prompts: [{ ...curated, id: 'peer-comparison', label: 'Peer Comparison', scope: 'matrix', requiredEvidenceKinds: ['matrix_evidence'] }] });
  render(<PromptsLibrary isOpen onClose={() => {}} symbol="VNM" />);
  expect(await screen.findByText(/Missing requirement: attach an authorized frozen Matrix selection/)).toBeInTheDocument();
});

test('Matrix workflow selection omits unrelated current symbol so server scope stays authorized', async () => {
  jest.mocked(getCopilotPrompts).mockResolvedValue({ prompts: [{ ...curated, id: 'peer-comparison', label: 'Peer Comparison', scope: 'matrix', requiredEvidenceKinds: ['matrix_evidence'] }] });
  const select = jest.fn();
  render(<PromptsLibrary isOpen onClose={() => {}} onSelectPrompt={select} symbol="VNM" />);
  fireEvent.click(await screen.findByText('Peer Comparison'));
  expect(select).toHaveBeenCalledWith('Review VNM', { id: 'peer-comparison', revision: 1 }, expect.objectContaining({ scope: 'matrix' }));
  expect(select.mock.calls[0][1]).not.toHaveProperty('symbol');
});
