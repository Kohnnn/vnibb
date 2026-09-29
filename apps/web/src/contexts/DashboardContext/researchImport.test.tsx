import { act, renderHook, waitFor } from '@testing-library/react';
import { DashboardProvider, useDashboard } from './index';
import { FOLDERS_KEY, STORAGE_KEY } from './constants';
import { RESEARCH_NOTEBOOK_KEY, readNotebookItems, type NotebookItem } from '@/lib/researchNotebook';
import { createResearchBundle, planResearchImport } from '@/lib/researchBundle';
import type { InvestmentThesis } from '@/lib/investorWorkflow';

jest.mock('@/lib/api', () => ({ getPublishedSystemDashboardTemplates: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('@/lib/useDashboardSync', () => ({ useDashboardSync: jest.fn(), useLoadFromBackend: jest.fn() }));

const evidence: NotebookItem = { id: 'nb:old', kind: 'news', title: 'FPT evidence', createdAt: '2026-07-20T00:00:00Z' };
const thesis: InvestmentThesis = { status: 'researching', thesis: 'Growth', catalysts: 'Demand', risks: 'Competition', invalidation: 'Margin', reviewDate: '2026-12-31', notebookItemIds: ['nb:old'] };

beforeEach(() => window.localStorage.clear());
afterEach(() => jest.restoreAllMocks());

it('imports research originals and theses as a separate persisted dashboard without replacing existing records', async () => {
    localStorage.setItem(RESEARCH_NOTEBOOK_KEY, JSON.stringify([evidence]));
    const view = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(view.result.current.localStateReady).toBe(true));
    const before = view.result.current.state.dashboards.length;
    const bundle = createResearchBundle([{ symbol: 'FPT', thesis }], [evidence]);
    const plan = planResearchImport(bundle, readNotebookItems(), new Set(['FPT']), () => 'nb:imported');
    act(() => view.result.current.importResearchBundle(plan));
    expect(view.result.current.state.dashboards).toHaveLength(before + 1);
    const imported = view.result.current.state.dashboards.at(-1)!;
    expect(imported.tabs[0].widgets[0].config).toMatchObject({ symbol: 'FPT', thesesBySymbol: { FPT: { notebookItemIds: ['nb:imported'] } } });
    expect(readNotebookItems().map(({ id }) => id)).toEqual(['nb:imported', 'nb:old']);
    view.unmount();
    const reloaded = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(reloaded.result.current.state.dashboards.find(({ id }) => id === imported.id)).toEqual(imported));
});

it('rolls back notebook and dashboards when dashboard storage rejects import', async () => {
    const view = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(view.result.current.localStateReady).toBe(true));
    const before = view.result.current.state;
    const notebookBefore = localStorage.getItem(RESEARCH_NOTEBOOK_KEY);
    const dashboardsBefore = localStorage.getItem(STORAGE_KEY);
    const original = Storage.prototype.setItem;
    let denied = false;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === FOLDERS_KEY && !denied) { denied = true; throw new DOMException('Storage full', 'QuotaExceededError'); }
        original.call(this, key, value);
    });
    const plan = planResearchImport(createResearchBundle([{ symbol: 'FPT', thesis }], [evidence]), [], new Set(), () => 'nb:imported');
    expect(() => act(() => view.result.current.importResearchBundle(plan))).toThrow(/Could not save/);
    expect(view.result.current.state).toBe(before);
    expect(localStorage.getItem(RESEARCH_NOTEBOOK_KEY)).toBe(notebookBefore);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(dashboardsBefore);
});
