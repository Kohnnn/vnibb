import { boundedMatrixWidth, hiddenMatrixSelectionCount, matrixRequestText, matrixViewFromConfig } from './matrix';
import type { MatrixCell, MatrixResearchRequest } from '@/types/matrix';

jest.mock('@/lib/api', () => ({ fetchAPI: jest.fn() }));

it('keeps reference handoff free of protected values and evidence', () => {
  const packet = {
    request_text: 'Compare selected company results using the authorized frozen snapshot.',
    snapshot_id: 'snapshot-123', revision: 'revision-456', result_ids: ['result-789'],
    snapshot: { cells: [{ payload: { text: 'PROTECTED_TEXT', metrics: [{ display: 'PROTECTED_VALUE' }] }, basis: 'PROTECTED_BASIS' }] },
    evidence: [{ locator: 'PROTECTED_LOCATOR' }],
  } as unknown as MatrixResearchRequest;
  const text = matrixRequestText(packet);
  expect(text).toContain('snapshot-123');
  expect(text).toContain('revision-456');
  expect(text).toContain('result-789');
  expect(text).not.toContain('PROTECTED_');
});

it('counts hidden selections by result identity, independent of coordinates', () => {
  const cells = [{ result_id: 'b' }, { result_id: 'a' }] as MatrixCell[];
  expect(hiddenMatrixSelectionCount(new Set(['a', 'b']), cells)).toBe(0);
  expect(hiddenMatrixSelectionCount(new Set(['a', 'b']), cells.slice(0, 1))).toBe(1);
});

it('bounds persisted widths and discards content fields from view config', () => {
  expect(boundedMatrixWidth(900)).toBe(640);
  expect(boundedMatrixWidth(-20)).toBe(140);
  const view = matrixViewFromConfig({ widths: { narrow: -1, wide: 900 }, snapshotRefs: ['snapshot-1'], cells: [{ secret: true }], evidence: [{ secret: true }] });
  expect(view.widths).toEqual({ narrow: 140, wide: 640 });
  expect(view.snapshotRefs).toEqual(['snapshot-1']);
  expect(view).not.toHaveProperty('cells');
  expect(view).not.toHaveProperty('evidence');
});
