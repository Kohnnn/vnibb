import { dashboardReducer } from './reducer';
import type { DashboardState, Dashboard, DashboardTab } from '@/types/dashboard';

const now = '2026-01-01T00:00:00.000Z';

function tab(id: string, order: number): DashboardTab {
    return { id, name: id, order, widgets:[] };
}

function dashboard(id: string, tabs: DashboardTab[]): Dashboard {
    return {
        id,
        name: id,
        order: 0,
        isDefault:false,
        showGroupLabels:false,
        syncGroups: [],
        tabs,
        createdAt: now,
        updatedAt: now,
    };
}

function stateWith(activeDashboardId: string, activeTabId: string | null, dashboards: Dashboard[]): DashboardState {
    return { dashboards, folders: [], activeDashboardId, activeTabId };
}

// #102: clicking a workspace header dispatches SET_ACTIVE_DASHBOARD without a
// tab. The old reducer kept the previous dashboard's tab id, so the body
// rendered a permanent no-tab spinner and the URL lost its `tab` param.
describe('SET_ACTIVE_DASHBOARD resolves a valid tab in the same dispatch', () => {
    it('selects the target workspace tab when the current tab belongs to another workspace', () => {
        const state = stateWith('fundamental', 'fundamental-tab', [
            dashboard('fundamental', [tab('fundamental-tab', 0)]),
            dashboard('technical', [tab('technical-a', 0), tab('technical-b', 1)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'SET_ACTIVE_DASHBOARD',
            payload: { dashboardId: 'technical' },
        });

        expect(next.activeDashboardId).toBe('technical');
        expect(next.activeTabId).toBe('technical-a');
    });

    it('keeps the current tab when it belongs to the target workspace', () => {
        const state = stateWith('technical', 'technical-b', [
            dashboard('technical', [tab('technical-a', 0), tab('technical-b', 1)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'SET_ACTIVE_DASHBOARD',
            payload: { dashboardId: 'technical' },
        });

        expect(next.activeTabId).toBe('technical-b');
    });

    it('uses a remembered tab id when the caller supplies one', () => {
        const state = stateWith('fundamental', 'fundamental-tab', [
            dashboard('fundamental', [tab('fundamental-tab', 0)]),
            dashboard('technical', [tab('technical-a', 0), tab('technical-b', 1)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'SET_ACTIVE_DASHBOARD',
            payload: { dashboardId: 'technical', tabId: 'technical-b' },
        });

        expect(next.activeTabId).toBe('technical-b');
    });

    it('yields no active tab for a genuinely empty workspace instead of a stale one', () => {
        const state = stateWith('fundamental', 'fundamental-tab', [
            dashboard('fundamental', [tab('fundamental-tab', 0)]),
            dashboard('technical',[]),
        ]);

        const next = dashboardReducer(state, {
            type: 'SET_ACTIVE_DASHBOARD',
            payload: { dashboardId: 'technical' },
        });

        expect(next.activeDashboardId).toBe('technical');
        expect(next.activeTabId).toBeNull();
    });
});

// #110: published templates arrive after first paint. A workspace opened before
// they landed has no tab, so the dispatch that applies them must resolve one.
describe('APPLY_SYSTEM_TEMPLATES resolves the active tab', () => {
    it('adopts the first published tab when the open workspace had none', () => {
        const state = stateWith('technical', null, [dashboard('technical', [])]);

        const next = dashboardReducer(state, {
            type: 'APPLY_SYSTEM_TEMPLATES',
            payload: [dashboard('technical', [tab('published-a', 0), tab('published-b', 1)])],
        });

        expect(next.activeTabId).toBe('published-a');
    });

    it('keeps a still-valid active tab when templates reload', () => {
        const state = stateWith('technical', 'published-b', [
            dashboard('technical', [tab('published-a', 0), tab('published-b', 1)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'APPLY_SYSTEM_TEMPLATES',
            payload: [dashboard('technical', [tab('published-a', 0), tab('published-b', 1)])],
        });

        expect(next.activeTabId).toBe('published-b');
    });
});

describe('LOAD_STATE normalizes a stale tab id', () => {
    it('replaces a tab id that is not present in the loaded dashboard', () => {
        const state = stateWith('technical', null,[]);

        const next = dashboardReducer(state, {
            type: 'LOAD_STATE',
            payload: {
                dashboards: [dashboard('technical', [tab('live-tab', 0)])],
                folders: [],
                activeDashboardId: 'technical',
                activeTabId: 'stale-tab',
            },
        });

        expect(next.activeTabId).toBe('live-tab');
    });
});

describe('DELETE_DASHBOARD switches to a resolvable tab', () => {
    it('resolves the replacement workspace tab instead of keeping the deleted one', () => {
        const state = stateWith('doomed', 'doomed-tab', [
            dashboard('doomed', [tab('doomed-tab', 0)]),
            dashboard('keeper', [tab('keeper-tab', 0)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'DELETE_DASHBOARD',
            payload: { dashboardId: 'doomed' },
        });

        expect(next.activeDashboardId).toBe('keeper');
        expect(next.activeTabId).toBe('keeper-tab');
    });
});

// #110: a published record can arrive empty or malformed (partial response,
// failed publish). Replacing a working bundled layout with it left the workspace
// with zero tabs, which then rendered as an unavailable-workspace dead end.
describe('APPLY_SYSTEM_TEMPLATES ignores malformed published records', () => {
    it('keeps the bundled tabs when the published template has no tabs', () => {
        const state = stateWith('default-technical', 'tech-a', [
            dashboard('default-technical', [tab('tech-a', 0), tab('tech-b', 1)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'APPLY_SYSTEM_TEMPLATES',
            payload: [{ ...dashboard('default-technical', []), tabs: [] as DashboardTab[] }],
        });

        const technical = next.dashboards.find((d) => d.id === 'default-technical');
        expect(technical?.tabs.map((t) => t.id)).toEqual(['tech-a', 'tech-b']);
        expect(next.activeTabId).toBe('tech-a');
    });

    it('replaces the bundled tabs when the published template carries a usable layout', () => {
        const state = stateWith('default-technical', 'tech-a', [
            dashboard('default-technical', [tab('tech-a', 0)]),
        ]);

        const next = dashboardReducer(state, {
            type: 'APPLY_SYSTEM_TEMPLATES',
            payload: [dashboard('default-technical', [tab('published-a', 0)])],
        });

        const technical = next.dashboards.find((d) => d.id === 'default-technical');
        expect(technical?.tabs.map((t) => t.id)).toEqual(['published-a']);
        expect(next.activeTabId).toBe('published-a');
    });
});
