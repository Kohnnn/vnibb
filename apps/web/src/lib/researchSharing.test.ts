import { createResearchShare, listResearchShares, previewAuthorResearch, readResearchShare, revokeResearchShare } from './researchSharing';
import { fetchAPI } from './api';
import type { ResearchBundle } from './researchBundle';

jest.mock('./api', () => ({ fetchAPI: jest.fn() }));

const bundle: ResearchBundle = {
    format: 'vnibb-thesis-evidence', version: 1, createdAt: '2026-01-01T00:00:00Z',
    theses: [{ symbol: 'FPT', thesis: { status: 'active', thesis: 'Authored case', catalysts: '', risks: '', invalidation: '', reviewDate: '', notebookItemIds: ['nb:note', 'nb:provider'], citations: [{ itemId: 'nb:provider', title: 'Provider', capturedAt: '2026-01-01T00:00:00Z' }] } }],
    items: [
        { id: 'nb:note', kind: 'note', title: 'Authored', body: 'My note', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'nb:provider', kind: 'news', title: 'Provider', body: 'Provider original', createdAt: '2026-01-01T00:00:00Z' },
    ],
};

it('explicit preview excludes provider originals and all citations without mutating local bundle', () => {
    const preview = previewAuthorResearch(bundle);
    expect(preview.excludedOriginals).toBe(1);
    expect(preview.excludedCitations).toBe(1);
    expect(preview.bundle.items.map((item) => item.id)).toEqual(['nb:note']);
    expect(preview.bundle.theses[0].thesis.notebookItemIds).toEqual(['nb:note']);
    expect(preview.bundle.theses[0].thesis.citations).toBeUndefined();
    expect(bundle.items).toHaveLength(2);
    expect(bundle.theses[0].thesis.citations).toHaveLength(1);
});

it('does not reclassify notes with source metadata, agent data or client provenance as authored', () => {
    for (const metadata of [{ sources: [{ label: 'Provider' }] }, { agent: { model: 'model' } }, { artifact: { artifactId: 'x' } }, { provenance: {} }]) {
        expect(previewAuthorResearch({ ...bundle, items: [{ ...bundle.items[0], ...metadata }] }).bundle.items).toEqual([]);
    }
});

it('requires bearer authorization and no-store on create/list/read/revoke API seams', async () => {
    jest.mocked(fetchAPI).mockResolvedValue({});
    await createResearchShare(previewAuthorResearch(bundle).bundle, ['recipient'], '2026-10-10T00:00:00Z');
    await listResearchShares();
    await readResearchShare('share');
    await revokeResearchShare('share');
    expect(jest.mocked(fetchAPI).mock.calls).toHaveLength(4);
    for (const [, options] of jest.mocked(fetchAPI).mock.calls) expect(options).toMatchObject({ auth: 'required', cache: 'no-store' });
    expect(jest.mocked(fetchAPI).mock.calls[3]).toEqual(['/research-shares/share', expect.objectContaining({ method: 'DELETE' })]);
});
