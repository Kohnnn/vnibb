import { act, renderHook, waitFor } from '@testing-library/react';
import { DashboardProvider, useDashboard } from './index';
import { createWorkspaceBackup } from '@/lib/workspaceBackup';
import { FOLDERS_KEY, STORAGE_KEY, DASHBOARD_STORAGE_COMMIT_KEY } from './constants';
import type { DashboardState } from '@/types/dashboard';

jest.mock('@/lib/api', () => ({ getPublishedSystemDashboardTemplates: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('@/lib/useDashboardSync', () => ({ useDashboardSync: jest.fn(), useLoadFromBackend: jest.fn() }));

const source: DashboardState = {
    activeDashboardId: null, activeTabId: null,
    folders: [{ id: 'research', name: 'Research', order: 0, isExpanded: true }],
    dashboards: [{ id: 'old-dashboard', name: 'Restored research', folderId: 'research', order: 0, isDefault: false,
        showGroupLabels: true, createdAt: '2026-01-01', updatedAt: '2026-01-01', syncGroups: [],
        tabs: [{ id: 'research-tab', name: 'Thesis', order: 0, widgets: [{
            id: 'note', type: 'notes', tabId: 'research-tab', config: { text: 'Keep this research' },
            layout: { i: 'note-layout', x: 5, y: 8, w: 10, h: 6 },
        }] }],
    }],
};

beforeEach(() => window.localStorage.clear());
afterEach(() => jest.restoreAllMocks());

it('rolls back stored values and leaves live originals untouched when a restore write fails', async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(result.current.state.dashboards).toHaveLength(4));
    const before = result.current.state;
    const storedBefore = localStorage.getItem(STORAGE_KEY);
    const foldersBefore = localStorage.getItem(FOLDERS_KEY);
    const commitBefore = localStorage.getItem(DASHBOARD_STORAGE_COMMIT_KEY);
    const setItem = Storage.prototype.setItem;
    let rejected = false;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === FOLDERS_KEY && !rejected) {
            rejected = true;
            throw new DOMException('Storage full', 'QuotaExceededError');
        }
        setItem.call(this, key, value);
    });
    expect(() => act(() => result.current.restoreWorkspace(createWorkspaceBackup(source)))).toThrow(/Could not save/);
    expect(result.current.state).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(storedBefore);
    expect(localStorage.getItem(FOLDERS_KEY)).toBe(foldersBefore);
    expect(localStorage.getItem(DASHBOARD_STORAGE_COMMIT_KEY)).toBe(commitBefore);
});

it('persists imported copies before reporting success and keeps them after remount', async () => {
    const view = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(view.result.current.state.dashboards).toHaveLength(4));
    act(() => view.result.current.restoreWorkspace(createWorkspaceBackup(source)));
    const imported = view.result.current.state.dashboards.find((dashboard) => dashboard.name === 'Restored research')!;
    expect(imported.id).toMatch(/^import-/);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(view.result.current.state.dashboards);
    view.unmount();
    const reloaded = renderHook(() => useDashboard(), { wrapper: DashboardProvider });
    await waitFor(() => expect(reloaded.result.current.state.dashboards.find((dashboard) => dashboard.id === imported.id)).toEqual(imported));
    expect(reloaded.result.current.state.folders.find((folder) => folder.id === imported.folderId)?.name).toBe('Research');
});
