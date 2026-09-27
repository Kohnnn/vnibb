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
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG'], peer_basis: 'Same stored industry', periods: ['2025'], periods_by_symbol: { FPT: { year: ['2025'], quarter: ['2025-Q2'] }, CMG: { year: ['2025'], quarter: ['2025-Q2'] } }, period_type: 'year', limitations: [] });
  jest.spyOn(matrixApi, 'periods').mockImplementation(async (anchor, symbols) => {
    if (symbols.includes('XYZ')) throw new Error('Every selected company must have an active stored company record');
    return { anchor_symbol: anchor, playbook_id: 'nonfinancial', periods_by_symbol: Object.fromEntries(symbols.map((item) => [item, { year: ['2025'], quarter: ['2025-Q2'] }])) };
  });
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

it('offers latest common year on shortlist edits and independent common quarters', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({
    anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG', 'ABC'], peer_basis: 'Same stored industry',
    periods: ['2024'], period_type: 'year', limitations: [], periods_by_symbol: {
      FPT: { year: ['2025', '2024'], quarter: ['2025-Q2', '2025-Q1'] },
      CMG: { year: ['2025', '2024'], quarter: ['2025-Q2', '2025-Q1'] },
      ABC: { year: ['2024'], quarter: ['2025-Q1'] },
    },
  });
  jest.spyOn(matrixApi, 'periods').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', periods_by_symbol: {
    FPT: { year: ['2025', '2024'], quarter: ['2025-Q2', '2025-Q1'] },
    CMG: { year: ['2025', '2024'], quarter: ['2025-Q2', '2025-Q1'] },
  } });
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2024'));
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, CMG' } });
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2025'));
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  await waitFor(() => expect(matrixApi.create).toHaveBeenCalledWith(expect.objectContaining({ symbols: ['FPT', 'CMG'], period: '2025', period_type: 'year' })));
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, CMG, ABC' } });
  fireEvent.change(screen.getByLabelText('Period basis'), { target: { value: 'quarter' } });
  expect(screen.getByLabelText('Year')).toHaveValue('2025');
  expect(screen.getByLabelText('Quarter')).toHaveValue('2025-Q1');
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  await waitFor(() => expect(matrixApi.create).toHaveBeenLastCalledWith(expect.objectContaining({ symbols: ['FPT', 'CMG', 'ABC'], period: '2025-Q1', period_type: 'quarter' })));
  expect(matrixApi.prepare).toHaveBeenCalledTimes(1);
});

it('retains a selected common period on shortlist edits and never offers absent periods', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({
    anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG', 'ABC'], peer_basis: 'Same stored industry',
    periods: ['2024', '2023'], period_type: 'year', limitations: [], periods_by_symbol: {
      FPT: { year: ['2025', '2024', '2023'], quarter: ['2025-Q2', '2025-Q1'] },
      CMG: { year: ['2025', '2024', '2023'], quarter: ['2025-Q2', '2025-Q1'] },
      ABC: { year: ['2024', '2023'], quarter: ['2025-Q1'] },
    },
  });
  jest.spyOn(matrixApi, 'periods').mockImplementation(async (anchor, symbols) => {
    if (symbols.includes('XYZ')) throw new Error('Unknown company');
    return { anchor_symbol: anchor, playbook_id: 'nonfinancial', periods_by_symbol: Object.fromEntries(symbols.map((item) => [item, { year: ['2025', '2024', '2023'], quarter: ['2025-Q2', '2025-Q1'] }])) };
  });
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2024'));
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2023' } });
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, CMG' } });
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2023'));
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, XYZ' } });
  expect(screen.getByLabelText('Year')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();
  expect(matrixApi.prepare).toHaveBeenCalledTimes(1);
});

it('enables a stored common quarter when no annual year is shared', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({
    anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG'], peer_basis: 'Same stored industry',
    periods: [], period_type: 'year', limitations: [], periods_by_symbol: {
      FPT: { year: ['2025'], quarter: ['2025-Q2', '2025-Q1'] },
      CMG: { year: ['2024'], quarter: ['2025-Q1'] },
    },
  });
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue(''));
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Period basis'), { target: { value: 'quarter' } });
  expect(screen.getByLabelText('Year')).toHaveValue('2025');
  expect(screen.getByLabelText('Quarter')).toHaveValue('2025-Q1');
  expect(screen.queryByRole('option', { name: 'Q2' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  await waitFor(() => expect(matrixApi.create).toHaveBeenCalledWith(expect.objectContaining({ period: '2025-Q1', period_type: 'quarter' })));
});

it('authorizes a manually added eleventh eligible peer for annual and quarter creation', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  const proposed = ['FPT', ...Array.from({ length: 9 }, (_, index) => `P${index}`)];
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: proposed, peer_basis: 'Stored peers', periods: [], period_type: 'year', limitations: [], periods_by_symbol: Object.fromEntries(proposed.map((item) => [item, { year: ['2024'], quarter: ['2024-Q1'] }])) });
  jest.spyOn(matrixApi, 'periods').mockImplementation(async (anchor, selected) => ({ anchor_symbol: anchor, playbook_id: 'nonfinancial', periods_by_symbol: Object.fromEntries(selected.map((item) => [item, { year: ['2025'], quarter: ['2025-Q2'] }])) }));
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await screen.findByText('Stored peers');
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, P9' } });
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2025'));
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  await waitFor(() => expect(matrixApi.create).toHaveBeenCalledWith(expect.objectContaining({ symbols: ['FPT', 'P9'], period: '2025' })));
  fireEvent.change(screen.getByLabelText('Period basis'), { target: { value: 'quarter' } });
  expect(screen.getByLabelText('Quarter')).toHaveValue('2025-Q2');
  fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
  await waitFor(() => expect(matrixApi.create).toHaveBeenLastCalledWith(expect.objectContaining({ symbols: ['FPT', 'P9'], period: '2025-Q2' })));
  expect(matrixApi.periods).toHaveBeenCalledWith('FPT', ['FPT', 'P9']);
});

it('ignores an obsolete edited shortlist response and keeps ineligible peers blocked', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  const pending = Promise.withResolvers<{ anchor_symbol: string; playbook_id: string; periods_by_symbol: Record<string, { year: string[]; quarter: string[] }> }>();
  jest.spyOn(matrixApi, 'periods').mockImplementation((_anchor, selected) => selected.includes('BANK') ? pending.promise : Promise.reject(new Error('Unknown company')));
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await screen.findByText('Same stored industry');
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, BANK' } });
  await waitFor(() => expect(matrixApi.periods).toHaveBeenCalledWith('FPT', ['FPT', 'BANK']));
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, UNKNOWN' } });
  await act(async () => pending.resolve({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', periods_by_symbol: { FPT: { year: ['2025'], quarter: ['2025-Q2'] }, BANK: { year: ['2025'], quarter: ['2025-Q2'] } } }));
  await screen.findByText('Unknown company');
  expect(screen.getByLabelText('Year')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeDisabled();
});


it('keeps edited shortlist and selected year when preparing the same anchor again', async () => {
  mockUser = { id: 'owner-a', provider: 'supabase' };
  jest.spyOn(matrixApi, 'prepare').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', symbols: ['FPT', 'CMG'], peer_basis: 'Stored peers', periods: ['2025', '2024'], period_type: 'year', limitations: [], periods_by_symbol: {
    FPT: { year: ['2025', '2024'], quarter: [] }, CMG: { year: ['2025', '2024'], quarter: [] },
  } });
  jest.spyOn(matrixApi, 'periods').mockResolvedValue({ anchor_symbol: 'FPT', playbook_id: 'nonfinancial', periods_by_symbol: { FPT: { year: ['2025', '2024'], quarter: [] }, NEW: { year: ['2025', '2024'], quarter: [] } } });
  render(<MatrixWidget id="matrix" symbol="FPT" />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2025'));
  fireEvent.change(screen.getByLabelText('Companies · maximum 10'), { target: { value: 'FPT, NEW' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create snapshot' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2024' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare peer scope' }));
  await waitFor(() => expect(matrixApi.prepare).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Companies · maximum 10')).toHaveValue('FPT, NEW');
  expect(screen.getByLabelText('Year')).toHaveValue('2024');
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
