import { APIError, fetchAPI } from '@/lib/api';
import type { MatrixCell, MatrixCreate, MatrixEvidence, MatrixPlaybook, MatrixPreparation, MatrixResearchRequest, MatrixSelectedPeriods, MatrixSelection, MatrixSnapshot, MatrixView } from '@/types/matrix';

const root = '/matrix';
const protectedOptions = { auth: 'required' as const, cache: 'no-store' as const };
export const matrixApi = {
  playbooks: () => fetchAPI<MatrixPlaybook[]>(`${root}/playbooks`, { cache: 'no-store' }),
  prepare: (anchor: string) => fetchAPI<MatrixPreparation>(`${root}/prepare`, { params: { anchor_symbol: anchor }, cache: 'no-store' }),
  periods: (anchor: string, symbols: string[]) => fetchAPI<MatrixSelectedPeriods>(`${root}/periods?${new URLSearchParams([['anchor_symbol', anchor], ...symbols.map((symbol): [string, string] => ['symbols', symbol])])}`, { cache: 'no-store' }),
  fixture: () => fetchAPI<MatrixSnapshot>(`${root}/fixture`, { cache: 'no-store' }),
  create: (body: MatrixCreate) => fetchAPI<MatrixSnapshot>(`${root}/snapshots`, { ...protectedOptions, method: 'POST', body: JSON.stringify(body) }),
  snapshot: (id: string) => fetchAPI<MatrixSnapshot>(`${root}/snapshots/${encodeURIComponent(id)}`, protectedOptions),
  evidence: (snapshot: MatrixSnapshot, resultId: string) => fetchAPI<MatrixEvidence[]>(snapshot.synthetic ? `${root}/fixture/evidence` : `${root}/snapshots/${encodeURIComponent(snapshot.snapshot_id)}/evidence`, { ...(snapshot.synthetic ? { cache: 'no-store' as const } : protectedOptions), params: { result_id: resultId } }),
  selection: (selection: MatrixSelection) => fetchAPI<MatrixResearchRequest>(`${root}/selection`, { ...protectedOptions, method: 'POST', body: JSON.stringify(selection) }),
  review: (selection: MatrixSelection, state: 'reviewed' | 'unreviewed') => fetchAPI<MatrixSnapshot>(`${root}/snapshots/${encodeURIComponent(selection.snapshot_id)}/review`, { ...protectedOptions, method: 'POST', body: JSON.stringify({ result_ids: selection.result_ids, state }) }),
  revoke: (id: string) => fetchAPI<{ revoked: boolean }>(`${root}/snapshots/${encodeURIComponent(id)}/revoke`, { ...protectedOptions, method: 'POST' }),
};

export interface MatrixQuarantine {
  snapshotIds: string[];
  matrixId: string | null;
  message: string;
}

export function matrixQuarantine(reason: unknown): MatrixQuarantine | null {
  if (!(reason instanceof APIError) || reason.status !== 409 || !reason.responseBody || typeof reason.responseBody !== 'object') return null;
  const body = reason.responseBody;
  if (!('code' in body) || body.code !== 'matrix_snapshot_evidence_unverified') return null;
  const snapshotIds = 'snapshot_ids' in body && Array.isArray(body.snapshot_ids) ? body.snapshot_ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  const matrixId = 'matrix_id' in body && typeof body.matrix_id === 'string' && body.matrix_id ? body.matrix_id : null;
  return { snapshotIds, matrixId, message: reason.message };
}

export function boundedMatrixWidth(width: number): number {
  return Math.max(140, Math.min(640, Number.isFinite(width) ? width : 240));
}

export function matrixViewFromConfig(input: unknown): MatrixView {
  const value = input && typeof input === 'object' ? input as Partial<MatrixView> : {};
  const strings = (items: unknown): string[] => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [];
  return {
    density: value.density === 'compact' || value.density === 'expanded' ? value.density : 'standard',
    filter: typeof value.filter === 'string' ? value.filter : '',
    sort: value.sort === 'reverse' ? 'reverse' : 'symbol',
    pinned: strings(value.pinned),
    widths: Object.fromEntries(Object.entries(value.widths ?? {}).filter(([, width]) => typeof width === 'number').map(([key, width]) => [key, boundedMatrixWidth(width)])),
    hiddenDimensions: strings(value.hiddenDimensions),
    snapshotRefs: strings(value.snapshotRefs).slice(0, 20),
  };
}


export function hiddenMatrixSelectionCount(selection: ReadonlySet<string>, visibleCells: MatrixCell[]): number {
  const visible = new Set(visibleCells.map((cell) => cell.result_id));
  return [...selection].filter((id) => !visible.has(id)).length;
}

export function matrixRequestText(packet: MatrixResearchRequest): string {
  return [packet.request_text, '', `Snapshot: ${packet.snapshot_id}`, `Revision: ${packet.revision}`, `Selected result IDs: ${packet.result_ids.join(', ')}`].join('\n');
}
