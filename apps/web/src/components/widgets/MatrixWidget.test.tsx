import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MatrixWidget from './MatrixWidget';
import { matrixApi } from '@/lib/matrix';
import type { MatrixSnapshot } from '@/types/matrix';

let mockUser: { id: string; provider: string } | null = null;
const mockUpdateWidget = jest.fn();
const mockState = { dashboards: [{ id: 'dashboard', tabs: [{ id: 'tab', widgets: [{ id: 'matrix', config: {} }] }] }] };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: () => ({ state: mockState, updateWidget: mockUpdateWidget }) }));
jest.mock('@/lib/api', () => ({ fetchAPI: jest.fn(), APIError: class extends Error { status?: number } }));

const snapshot: MatrixSnapshot = {
  schema_version: 'matrix-v1', matrix_id: 'matrix-1', snapshot_id: 'snapshot-1', revision: 'revision-1', created_at: '2025-12-31T00:00:00Z', synthetic: true,
  anchor_symbol: 'FPT', playbook_id: 'nonfinancial', definition_revision: 'definition-1', period: '2025', period_type: 'year',
  entities: [{ entity_id: 'FPT', symbol: 'FPT', name: 'FPT Company', sector: 'Technology' }, { entity_id: 'CMG', symbol: 'CMG', name: 'CMC Company', sector: 'Technology' }],
  dimensions: [{ dimension_id: 'profit', label: 'Profit quality', question: 'Is profit supported?', output_type: 'table', source_scope: 'Stored statements', definition_revision: 'definition-1' }],
  cells: ['FPT', 'CMG'].map((entity_id) => ({ result_id: `result-${entity_id}`, entity_id, dimension_id: 'profit', result_revision: 'revision-1', state: 'supported', payload: { kind: 'table', metrics: [{ key: 'profit', label: 'Profit', value: '9007199254740993.125', display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] }] }, evidence_ids: ['observation-1'], basis: 'Consolidated', limitations: [], review_state: 'unreviewed' })),
  limitations: ['Stored observations, not original filings.'],
};

beforeEach(() => {
  mockUser = null;
  jest.restoreAllMocks();
  mockUpdateWidget.mockClear();
  jest.spyOn(matrixApi, 'playbooks').mockResolvedValue([{ playbook_id: 'nonfinancial', label: 'Nonfinancial', description: 'Stored classification required.', definition_revision: 'definition-1', dimensions: snapshot.dimensions }]);
  jest.spyOn(matrixApi, 'fixture').mockResolvedValue(snapshot);
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG'], peer_basis: 'Same stored industry', periods: ['2025'], period_type: 'year', limitations: [] });
  jest.spyOn(matrixApi, 'create').mockResolvedValue({ ...snapshot, synthetic: false });
  jest.spyOn(matrixApi, 'evidence').mockResolvedValue([]);
  jest.spyOn(matrixApi, 'selection');
});

it('keeps result selection stable when filtering and never creates research through view controls', async () => {
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  expect(matrixApi.fixture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Explore synthetic fixture' }));
  await screen.findByRole('table', { name: 'Company research Matrix' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select FPT Profit quality' }));
  fireEvent.change(screen.getByLabelText('Filter companies'), { target: { value: 'CMG' } });
  expect(screen.getByText('1 hidden by view')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Company order'), { target: { value: 'reverse' } });
  fireEvent.change(screen.getByLabelText('Density'), { target: { value: 'compact' } });
  fireEvent.change(screen.getByLabelText('Filter companies'), { target: { value: '' } });
  expect(screen.getByRole('checkbox', { name: 'Select FPT Profit quality' })).toBeChecked();
  expect(screen.getAllByText('9,007,199,254,740,993.125 VND')).toHaveLength(2);
  expect(matrixApi.create).not.toHaveBeenCalled();
  expect(matrixApi.selection).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Copy request' })).toBeDisabled();
  const persisted = mockUpdateWidget.mock.calls.at(-1)?.[3].config.matrixView;
  expect(persisted).not.toHaveProperty('cells');
  expect(JSON.stringify(persisted)).not.toContain('9,007,199');
});

it('drops a pending owned snapshot when the authenticated account changes', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  const { promise, resolve: resolveCreate } = Promise.withResolvers<MatrixSnapshot>();
  jest.spyOn(matrixApi, 'create').mockReturnValue(promise);
  const { rerender } = render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  mockUser = { id: 'owner-b', provider: 'supabase' };
  rerender(<MatrixWidget id="matrix" symbol="FPT" />);
  await act(async () => { resolveCreate({ ...snapshot, synthetic: false }); });
  expect(screen.queryByRole('table', { name: 'Company research Matrix' })).not.toBeInTheDocument();
  expect(mockUpdateWidget).not.toHaveBeenCalled();
});

it('requires verified auth for creation and restores focus after evidence inspection', async () => {
  mockUser = { id: 'dev-admin', provider: 'dev' };
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await screen.findByText('Same stored industry');
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Explore synthetic fixture' }));
  const result = await screen.findByRole('button', { name: 'Inspect FPT Profit quality' });
  result.focus(); fireEvent.click(result);
  fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
  await screen.findByText('No evidence retained. See basis and limitations.');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(result).toHaveFocus();
});

it('removes owned content and ignores in-flight evidence after revocation', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  const { promise, resolve } = Promise.withResolvers<[]>();
  jest.spyOn(matrixApi, 'evidence').mockReturnValue(promise);
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect FPT Profit quality' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
  act(() => window.dispatchEvent(new CustomEvent('vnibb:matrix-revoked', { detail: { snapshot_id: snapshot.snapshot_id } })));
  await act(async () => resolve([]));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('9,007,199,254,740,993.125 VND')).not.toBeInTheDocument();
  expect(mockUpdateWidget.mock.calls.at(-1)?.[3].config.matrixView.snapshotRefs).toEqual([]);
});

it('traps narrow inspector keyboard focus and restores the initiating result', async () => {
  jest.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() } as unknown as MediaQueryList);
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore synthetic fixture' }));
  const result = await screen.findByRole('button', { name: 'Inspect FPT Profit quality' });
  result.focus(); fireEvent.click(result);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('tab', { name: 'Review' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(result).toHaveFocus();
});
