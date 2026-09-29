import { createResearchBundle, parseResearchBundle, planResearchImport } from './researchBundle';
import type { NotebookItem } from './researchNotebook';
import { citeNotebookItem, type InvestmentThesis } from './investorWorkflow';

const original: NotebookItem = {
    id: 'nb:original', kind: 'news', title: 'Earnings release', body: 'Original private research', symbol: 'FPT',
    createdAt: '2026-07-20T00:00:00.000Z', sources: [{ id: 'source-1', url: 'https://example.test/fpt' }],
};
const thesis: InvestmentThesis = {
    status: 'active', thesis: 'Growing', catalysts: 'Capacity', risks: 'Execution', invalidation: 'Margins',
    reviewDate: '2026-12-31', notebookItemIds: ['nb:original', 'nb:evicted'],
    citations: [citeNotebookItem(original),
        { itemId: 'nb:evicted', title: 'Old article', capturedAt: '2025-01-01T00:00:00Z' }],
};

it('round-trips selected thesis evidence with immutable citations, remaps collisions and keeps local research', () => {
    const bundle = parseResearchBundle(JSON.stringify(createResearchBundle([{ symbol: 'FPT', thesis, note: 'Private' }], [original])));
    expect(bundle.items).toEqual([expect.objectContaining({ body: 'Original private research' })]);
    const local = { ...original, body: 'Existing local content' };
    let n = 0;
    const plan = planResearchImport(bundle, [local], new Set(['FPT']), () => `nb:import-${++n}`);
    expect(plan.items[0]).toMatchObject({ id: 'nb:import-1', body: 'Original private research' });
    expect(local).toMatchObject({ id: 'nb:original', body: 'Existing local content' });
    expect(plan.theses[0].thesis.notebookItemIds).toEqual(['nb:import-1', 'nb:import-2']);
    expect(plan.theses[0].thesis.citations?.map(({ itemId }) => itemId)).toEqual(['nb:import-1', 'nb:import-2']);
    expect(plan.summary).toEqual({ theses: 1, evidence: 1, remappedIds: 1, symbolConflicts: 1, missingOriginals: 1 });
    expect(plan.items.some((item) => item.id === 'nb:import-2')).toBe(false);
});

it('omits a reused notebook ID with different citation identity instead of exporting unrelated private content', () => {
    const unrelated = { ...original, title: 'Someone else’s note', body: 'Do not transfer', createdAt: '2026-08-01T00:00:00.000Z' };
    const bundle = createResearchBundle([{ symbol: 'FPT', thesis }], [unrelated]);
    expect(bundle.items).toEqual([]);
    expect(bundle.theses[0].thesis.citations).toEqual(thesis.citations);
    let counter = 0;
    const imported = planResearchImport(bundle, [unrelated], new Set(), () => `nb:missing-${++counter}`);
    expect(imported.summary.missingOriginals).toBe(2);
    expect(imported.items).toEqual([]);
    expect(imported.theses[0].thesis.citations?.[0].title).toBe('Earnings release');
});

it('rejects workspace configurations, unsupported versions and malformed citations without importing', () => {
    const bundle = createResearchBundle([{ symbol: 'FPT', thesis }], [original]);
    expect(() => parseResearchBundle('{broken')).toThrow(/valid JSON/);
    expect(() => parseResearchBundle(JSON.stringify({ ...bundle, format: 'vnibb-personal-workspace' }))).toThrow(/format or version/);
    expect(() => parseResearchBundle(JSON.stringify({ ...bundle, version: 2 }))).toThrow(/format or version/);
    expect(() => parseResearchBundle(JSON.stringify({ ...bundle, theses: [{ symbol: 'FPT', thesis: { ...thesis, citations: [{ itemId: 'nb:original', body: 'Forged', capturedAt: original.createdAt }] } }] }))).toThrow(/citations/);
    expect(() => parseResearchBundle(JSON.stringify({ ...bundle, items: [original, original] }))).toThrow(/Duplicate notebook IDs/);
    expect(() => parseResearchBundle(JSON.stringify({ ...bundle, theses: [{ symbol: 'FPT', thesis: { ...thesis, notebookItemIds: ['nb:original'], citations: [{ itemId: 'nb:original', title: 'Wrong', capturedAt: 'invalid' }] } }] }))).toThrow(/citations/);
    const unsafe = JSON.stringify(bundle).replace('"thesis":"Growing"', '"__proto__":{"polluted":true},"thesis":"Growing"');
    expect(() => parseResearchBundle(unsafe)).toThrow(/unsafe/);
});
