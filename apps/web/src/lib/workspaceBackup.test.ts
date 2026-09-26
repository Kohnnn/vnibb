import type { DashboardState } from '@/types/dashboard';
import { createWorkspaceBackup, importWorkspaceBackup, parseWorkspaceBackup, previewWorkspaceBackup, WORKSPACE_BACKUP_EXCLUSIONS } from './workspaceBackup';
import { DEFAULT_GROUPS } from '@/types/widget';

const original: DashboardState = {
    activeDashboardId: '101', activeTabId: 'tab-a',
    folders: [
        { id: 'folder-initial', name: 'Initial', order: 0, isExpanded: true },
        { id: 'research', name: 'Research', order: 1, isExpanded: true },
        { id: 'nested', name: 'Nested', order: 2, parentId: 'research', isExpanded: false },
    ],
    dashboards: [
        {
            id: 'default-fundamental', name: 'Protected system', folderId: 'folder-initial', order: 0,
            isDefault: true, isEditable: false, showGroupLabels: true, createdAt: '2026-01-01', updatedAt: '2026-01-01', tabs: [], syncGroups: [],
        },
        {
            id: '101', name: 'Research desk', folderId: 'nested', order: 1, isDefault: false, isEditable: true,
            showGroupLabels: false, createdAt: '2026-01-01', updatedAt: '2026-01-02',
            syncGroups: [{ id: 9, name: 'Group', color: '#abc', currentSymbol: 'VNM' }],
            tabs: [
                { id: 'tab-a', name: 'Deep research', order: 0, widgets: [{
                    id: 'widget-a', tabId: 'tab-a', type: 'price_chart', syncGroupId: 9,
                    config: { indicators: ['SMA'], nested: { symbol: 'FPT', scale: [1, null, true] } },
                    layout: { i: 'layout-a', x: 6, y: 12, w: 8, h: 5, minH: 3 },
                }] },
                { id: 'tab-b', name: 'Notes', order: 1, widgets: [{
                    id: 'widget-b', tabId: 'tab-b', type: 'notes', config: { text: 'My notes' },
                    layout: { i: 'layout-b', x: 1, y: 3, w: 10, h: 6 },
                }] },
            ],
        },
    ],
};

describe('personal workspace backup', () => {
    it('roundtrips multiple tabs, nested folders, widget config and group references without changing existing work', () => {
        const backup = parseWorkspaceBackup(JSON.stringify(createWorkspaceBackup(original)));
        const preview = previewWorkspaceBackup(backup);
        expect(preview).toMatchObject({ dashboards: 1, tabs: 2, widgets: 2, syncGroups: 1, folders: 2, dashboardNames: ['Research desk'], folderNames: ['Research', 'Nested'] });
        expect(preview.exclusions).toBe(WORKSPACE_BACKUP_EXCLUSIONS);
        expect(JSON.stringify(backup)).not.toContain('Protected system');
        expect(backup).not.toHaveProperty('settings');
        let counter = 0;
        const restored = importWorkspaceBackup(original, backup, () => `id-${++counter}`);
        expect(restored.dashboards.slice(0, 2)).toEqual(original.dashboards);
        expect(restored.folders.slice(0, 3)).toEqual(original.folders);
        const imported = restored.dashboards[2];
        expect(imported.id).toMatch(/^import-/);
        expect(imported.id).not.toBe('101');
        expect(imported.folderId).toBe(restored.folders[4].id);
        expect(restored.folders[4].parentId).toBe(restored.folders[3].id);
        expect(imported.tabs.map((tab) => tab.name)).toEqual(['Deep research', 'Notes']);
        expect(imported.tabs[0].widgets[0]).toMatchObject({
            tabId: imported.tabs[0].id, syncGroupId: imported.syncGroups[0].id,
            config: original.dashboards[1].tabs[0].widgets[0].config,
            layout: { x: 6, y: 12, w: 8, h: 5, minH: 3 },
        });
        expect(imported.tabs[0].widgets[0].id).not.toBe('widget-a');
        expect(imported.tabs[0].widgets[0].layout.i).not.toBe('layout-a');
        expect(restored.activeDashboardId).toBe('101');
    });

    it('keeps a promoted widget’s artifact provenance through an export and import round trip', () => {
        const promoted: DashboardState = {
            ...original,
            dashboards: [
                { ...original.dashboards[0] },
                {
                    ...original.dashboards[1],
                    tabs: [{
                        id: 'tab-artifact', name: 'Chart', order: 0,
                        widgets: [{
                            id: 'widget-artifact', tabId: 'tab-artifact', type: 'price_chart',
                            config: { symbol: 'FPT', copilotArtifactProvenance: { artifactId: 'price_trend_chart', responseId: 'resp:1', artifactType: 'chart' } },
                            layout: { i: 'la', x: 0, y: 0, w: 8, h: 6 },
                        }],
                    }],
                },
            ],
        };
        const backup = parseWorkspaceBackup(JSON.stringify(createWorkspaceBackup(promoted)));
        const restored = importWorkspaceBackup(promoted, backup, (() => { let n = 0; return () => `prov-${++n}`; })());
        const imported = restored.dashboards[restored.dashboards.length - 1].tabs[0].widgets[0];
        expect(imported.config.copilotArtifactProvenance).toMatchObject({ artifactId: 'price_trend_chart', responseId: 'resp:1' });
    });

    it('normalizes legacy widget type aliases so imported widgets resolve in the registry', () => {
        const legacy: DashboardState = {
            ...original,
            dashboards: [
                { ...original.dashboards[0] },
                {
                    ...original.dashboards[1],
                    tabs: [{
                        id: 'tab-legacy', name: 'Legacy', order: 0,
                        widgets: [
                            { id: 'widget-legacy-1', tabId: 'tab-legacy', type: 'financials' as never, config: { symbol: 'FPT' }, layout: { i: 'l1', x: 0, y: 0, w: 8, h: 6 } },
                            { id: 'widget-legacy-2', tabId: 'tab-legacy', type: 'company_profile' as never, config: {}, layout: { i: 'l2', x: 8, y: 0, w: 8, h: 6 } },
                            { id: 'widget-legacy-3', tabId: 'tab-legacy', type: 'economic_calendar' as never, config: {}, layout: { i: 'l3', x: 16, y: 0, w: 8, h: 6 } },
                        ],
                    }],
                },
            ],
        };
        const backup = createWorkspaceBackup(legacy);
        const restored = importWorkspaceBackup(legacy, backup, (() => { let n = 0; return () => `legacy-${++n}`; })());
        const imported = restored.dashboards[restored.dashboards.length - 1];
        expect(imported.tabs[0].widgets.map((widget) => widget.type))
            .toEqual(['unified_financials', 'ticker_profile', 'tradingview_economic_calendar']);
    });

    it('rejects malformed JSON, unsupported versions, unknown widgets and broken references rather than dropping content', () => {
        const backup = createWorkspaceBackup(original);
        expect(() => parseWorkspaceBackup('{oops')).toThrow(/not valid JSON/);
        expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow(/version/);
        const broken: typeof backup = JSON.parse(JSON.stringify(backup));
        broken.dashboards[0].tabs[0].widgets[0].type = 'unknown_future_widget' as typeof broken.dashboards[0]['tabs'][0]['widgets'][0]['type'];
        expect(() => parseWorkspaceBackup(JSON.stringify(broken))).toThrow(/unknown widget/);
        broken.dashboards[0].tabs[0].widgets[0].type = 'price_chart';
        broken.dashboards[0].folderId = 'missing';
        expect(() => parseWorkspaceBackup(JSON.stringify(broken))).toThrow(/references/);
    });

    it('rejects proto-polluting config, unexpected secrets and embedded system dashboards', () => {
        const backup = createWorkspaceBackup(original);
        const polluted = JSON.stringify(backup).replace('"indicators"', '"__proto__":{"polluted":true},"indicators"');
        expect(() => parseWorkspaceBackup(polluted)).toThrow(/Invalid dashboard/);
        expect({}).not.toHaveProperty('polluted');
        expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, apiKey: 'secret' }))).toThrow(/format/);
        expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, dashboards: original.dashboards }))).toThrow(/Invalid dashboard/);
    });

    it('preserves independent global and A-D symbols in every imported workspace', () => {
        const groups = { ...DEFAULT_GROUPS, global: { ...DEFAULT_GROUPS.global, symbol: 'SSI' }, A: { ...DEFAULT_GROUPS.A, symbol: 'FPT' } };
        const backup = createWorkspaceBackup(original, groups);
        const restored = importWorkspaceBackup(original, parseWorkspaceBackup(JSON.stringify(backup)));
        expect(restored.dashboards[2].widgetGroups).toEqual(groups);
        expect(restored.dashboards[1].widgetGroups).toBeUndefined();
        expect(restored.dashboards[2].widgetGroups).not.toBe(groups);
    });

    it('rejects credential-bearing config and impossible authored geometry', () => {
        const backup = createWorkspaceBackup(original);
        const widget = backup.dashboards[0].tabs[0].widgets[0];
        widget.config = { nested: { accessToken: 'secret' } };
        expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow(/Invalid dashboard/);
        widget.config = {};
        for (const layout of [{ x: -1, w: 8 }, { x: 20, w: 8 }, { x: 1, w: 0 }, { x: 1.5, w: 8 }]) {
            widget.layout = { ...widget.layout, ...layout };
            expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow(/Invalid dashboard/);
        }
    });

    it('remaps IDs despite collision with the generator and preserves the original dashboard', () => {
        const backup = createWorkspaceBackup(original);
        let calls = 0;
        const state: DashboardState = { ...original, folders: [...original.folders, { id: 'folder-import-collision', name: 'Collision', order: 3, isExpanded: true }] };
        const result = importWorkspaceBackup(state, backup, () => ++calls <= 1 ? 'collision' : `new-${calls}`);
        expect(result.folders.map((folder) => folder.id)).toEqual(expect.arrayContaining(['folder-import-collision', 'folder-import-new-2']));
        expect(result.dashboards[1]).toBe(original.dashboards[1]);
    });
});
