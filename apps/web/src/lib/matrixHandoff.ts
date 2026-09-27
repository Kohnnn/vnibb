import type { MatrixSelection } from '@/types/matrix';

export const MATRIX_FOLLOWUP_EVENT = 'vnibb:matrix-followup';

export interface MatrixFollowupDraft {
    selection: MatrixSelection;
    request_text: string;
}

export function readMatrixFollowupDraft(detail: unknown): MatrixFollowupDraft | null {
    if (!detail || typeof detail !== 'object') return null;
    const { selection, request_text } = detail as Partial<MatrixFollowupDraft>;
    if (!selection || typeof selection.snapshot_id !== 'string' || !selection.snapshot_id.trim()) return null;
    if (typeof request_text !== 'string' || !request_text.trim()) return null;
    if (!Array.isArray(selection.result_ids) || selection.result_ids.length < 1 || selection.result_ids.length > 120) return null;
    if (selection.result_ids.some((id) => typeof id !== 'string' || !id.trim())) return null;
    if (new Set(selection.result_ids).size !== selection.result_ids.length) return null;
    return {
        selection: { snapshot_id: selection.snapshot_id, result_ids: [...selection.result_ids] },
        request_text,
    };
}
