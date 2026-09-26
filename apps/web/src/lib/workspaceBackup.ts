import { normalizeWidgetType } from '@/data/widgetDefinitions';
import { GLOBAL_SYSTEM_TEMPLATE_IDS, INITIAL_FOLDER_ID } from '@/contexts/DashboardContext/constants';
import type { Dashboard, DashboardFolder, DashboardState, WidgetInstance } from '@/types/dashboard';
import { DEFAULT_GROUPS, type WidgetGroupConfig, type WidgetGroupId } from '@/types/widget';

export const WORKSPACE_BACKUP_VERSION = 1;
export const MAX_WORKSPACE_BACKUP_BYTES = 5 * 1024 * 1024;
export const WORKSPACE_BACKUP_EXCLUSIONS = 'System and administrator layouts, stored authentication, settings, templates and unrelated browser storage are not included. Widget configuration and user-entered content are included; review the file before sharing. Known credential fields are rejected, not silently removed.';

export interface WorkspaceBackup {
    format: 'vnibb-personal-workspace';
    version: 1;
    createdAt: string;
    dashboards: Dashboard[];
    folders: DashboardFolder[];
}

export interface WorkspaceBackupPreview {
    dashboards: number;
    tabs: number;
    widgets: number;
    syncGroups: number;
    folders: number;
    dashboardNames: string[];
    folderNames: string[];
    exclusions: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function optionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function jsonSafe(value: unknown, depth = 0): boolean {
    if (depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => jsonSafe(item, depth + 1));
    if (!record(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
    return Object.entries(value).every(([key, item]) =>
        key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
        && !/^(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|auth[-_]?header|password|secret|client[-_]?secret|private[-_]?key|credentials)$/i.test(key)
        && jsonSafe(item, depth + 1)
    );
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

function validateWidget(widget: unknown, tabId: string, groupIds: Set<number>): widget is WidgetInstance {
    if (!record(widget) || !onlyKeys(widget, ['id', 'type', 'tabId', 'syncGroupId', 'widgetGroup', 'config', 'layout'])
        || !string(widget.id) || widget.tabId !== tabId || !string(widget.type) || !normalizeWidgetType(widget.type)) return false;
    if (widget.syncGroupId !== undefined && (!finite(widget.syncGroupId) || !groupIds.has(widget.syncGroupId))) return false;
    if (widget.widgetGroup !== undefined && !['global', 'A', 'B', 'C', 'D'].includes(widget.widgetGroup as string)) return false;
    if (!record(widget.config) || !jsonSafe(widget.config)
        || !optionalString(widget.config.symbol) || !optionalString(widget.config.timeframe)
        || (widget.config.refreshInterval !== undefined && !finite(widget.config.refreshInterval))
        || (widget.config.collapsed !== undefined && typeof widget.config.collapsed !== 'boolean')
        || (widget.config.indicators !== undefined && (!Array.isArray(widget.config.indicators) || !widget.config.indicators.every((item: unknown) => typeof item === 'string')))) return false;
    const layout = widget.layout;
    return record(layout) && onlyKeys(layout, ['i', 'x', 'y', 'w', 'h', 'minW', 'minH', 'maxW', 'maxH', 'static'])
        && string(layout.i) && ['x', 'y', 'w', 'h'].every((key) => finite(layout[key]) && Number.isInteger(layout[key]))
        && (layout.x as number) >= 0 && (layout.y as number) >= 0 && (layout.w as number) > 0 && (layout.h as number) > 0
        && (layout.x as number) + (layout.w as number) <= 24
        && ['minW', 'minH', 'maxW', 'maxH'].every((key) => layout[key] === undefined || (finite(layout[key]) && Number.isInteger(layout[key]) && (layout[key] as number) > 0))
        && (layout.static === undefined || typeof layout.static === 'boolean');
}

function unique(ids: string[]): boolean {
    return new Set(ids).size === ids.length;
}

function validWidgetGroups(groups: unknown): boolean {
    return record(groups) && onlyKeys(groups, ['global', 'A', 'B', 'C', 'D'])
        && ['global', 'A', 'B', 'C', 'D'].every((id) => {
            const group = groups[id];
            return record(group) && onlyKeys(group, ['id', 'name', 'color', 'symbol'])
                && group.id === id && string(group.name) && string(group.color) && string(group.symbol);
        });
}

function validateDashboard(dashboard: unknown): dashboard is Dashboard {
    if (!record(dashboard) || !onlyKeys(dashboard, ['id', 'name', 'description', 'globalMarketsSymbol', 'folderId', 'order', 'isDefault', 'showGroupLabels', 'tabs', 'syncGroups', 'widgetGroups', 'createdAt', 'updatedAt'])
        || !string(dashboard.id) || !string(dashboard.name) || !finite(dashboard.order)
        || !optionalString(dashboard.description) || !optionalString(dashboard.folderId) || !optionalString(dashboard.globalMarketsSymbol)
        || typeof dashboard.showGroupLabels !== 'boolean' || typeof dashboard.isDefault !== 'boolean'
        || !string(dashboard.createdAt) || !Number.isFinite(Date.parse(dashboard.createdAt))
        || !string(dashboard.updatedAt) || !Number.isFinite(Date.parse(dashboard.updatedAt))
        || !Array.isArray(dashboard.tabs) || !Array.isArray(dashboard.syncGroups)) return false;
    if (GLOBAL_SYSTEM_TEMPLATE_IDS.has(dashboard.id)) return false;
    if (!validWidgetGroups(dashboard.widgetGroups)) return false;
    const groups = dashboard.syncGroups;
    if (!groups.every((group: unknown) => record(group) && onlyKeys(group, ['id', 'name', 'color', 'currentSymbol'])
        && finite(group.id) && string(group.name) && string(group.color) && string(group.currentSymbol))) return false;
    const groupIds = new Set<number>(groups.map((group: { id: number }) => group.id));
    if (groupIds.size !== groups.length) return false;
    const tabs = dashboard.tabs;
    if (!tabs.every((tab: unknown) => record(tab) && onlyKeys(tab, ['id', 'name', 'order', 'widgets'])
        && string(tab.id) && string(tab.name) && finite(tab.order) && Array.isArray(tab.widgets)
        && tab.widgets.every((widget: unknown) => validateWidget(widget, tab.id as string, groupIds))
        && unique(tab.widgets.map((widget: { id: string }) => widget.id))
        && unique(tab.widgets.map((widget: { layout: { i: string } }) => widget.layout.i)))) return false;
    return unique(tabs.map((tab: { id: string }) => tab.id));
}

function validateBackup(value: unknown): asserts value is WorkspaceBackup {
    if (!record(value) || !onlyKeys(value, ['format', 'version', 'createdAt', 'dashboards', 'folders'])
        || value.format !== 'vnibb-personal-workspace' || value.version !== WORKSPACE_BACKUP_VERSION) {
        throw new Error('Unsupported workspace backup format or version. No workspaces were imported.');
    }
    if (!string(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.dashboards) || !Array.isArray(value.folders)) {
        throw new Error('Invalid workspace backup metadata. No workspaces were imported.');
    }
    if (!jsonSafe(value) || !value.dashboards.every(validateDashboard)) {
        throw new Error('Invalid dashboard or unknown widget type in workspace backup. No workspaces were imported.');
    }
    if (!value.folders.every((folder: unknown) => record(folder) && onlyKeys(folder, ['id', 'name', 'parentId', 'order', 'isExpanded'])
        && string(folder.id) && string(folder.name)
        && finite(folder.order) && typeof folder.isExpanded === 'boolean' && optionalString(folder.parentId))) {
        throw new Error('Invalid folder in workspace backup. No workspaces were imported.');
    }
    const folders = value.folders as DashboardFolder[];
    const dashboards = value.dashboards as Dashboard[];
    const folderIds = new Set(folders.map((folder) => folder.id));
    if (!unique(folders.map((folder) => folder.id)) || !unique(dashboards.map((dashboard) => dashboard.id))
        || folders.some((folder) => folder.parentId && (!folderIds.has(folder.parentId) || folder.parentId === folder.id))
        || dashboards.some((dashboard) => dashboard.folderId && !folderIds.has(dashboard.folderId))) {
        throw new Error('Broken or duplicate workspace references. No workspaces were imported.');
    }
    for (const folder of folders) {
        const seen = new Set<string>();
        let cursor: DashboardFolder | undefined = folder;
        while (cursor) {
            if (seen.has(cursor.id)) throw new Error('Cyclic folder hierarchy. No workspaces were imported.');
            seen.add(cursor.id);
            cursor = folders.find((item) => item.id === cursor?.parentId);
        }
    }
}

function cloneJson<T>(value: T): T {
    const cloned = JSON.parse(JSON.stringify(value)) as T;
    if (!jsonSafe(cloned)) throw new Error('Workspace contains unsafe configuration; no data was exported.');
    return cloned;
}

export function createWorkspaceBackup(state: DashboardState, widgetGroups: Record<WidgetGroupId, WidgetGroupConfig> = DEFAULT_GROUPS): WorkspaceBackup {
    for (const dashboard of state.dashboards) {
        if (GLOBAL_SYSTEM_TEMPLATE_IDS.has(dashboard.id) || dashboard.isEditable === false) continue;
        if (dashboard.tabs.some((tab) => tab.widgets.some((widget) => !jsonSafe(widget.config)))) {
            throw new Error('Workspace configuration must be safe JSON. No data was exported.');
        }
    }
    const dashboards = state.dashboards.filter((dashboard) => !GLOBAL_SYSTEM_TEMPLATE_IDS.has(dashboard.id) && dashboard.isEditable !== false)
        .map((dashboard) => ({
            id: dashboard.id, name: dashboard.name, description: dashboard.description,
            globalMarketsSymbol: dashboard.globalMarketsSymbol, folderId: dashboard.folderId,
            order: dashboard.order, isDefault: dashboard.isDefault,
            showGroupLabels: dashboard.showGroupLabels, tabs: dashboard.tabs, syncGroups: dashboard.syncGroups,
            widgetGroups: dashboard.widgetGroups ?? widgetGroups,
            createdAt: dashboard.createdAt, updatedAt: dashboard.updatedAt,
        } as Dashboard));
    const needed = new Set<string>([
        ...state.folders.filter((folder) => folder.id !== INITIAL_FOLDER_ID).map((folder) => folder.id),
        ...dashboards.flatMap((dashboard) => dashboard.folderId ? [dashboard.folderId] : []),
    ]);
    const folderById = new Map(state.folders.map((folder) => [folder.id, folder]));
    for (const id of needed) {
        const folder = folderById.get(id);
        if (!folder) throw new Error(`Workspace references missing folder: ${id}`);
        if (folder.parentId) needed.add(folder.parentId);
    }
    const folders = state.folders.filter((folder) => folder.id !== INITIAL_FOLDER_ID || needed.has(folder.id))
        .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId, order: folder.order, isExpanded: folder.isExpanded }));
    const backup: WorkspaceBackup = {
        format: 'vnibb-personal-workspace', version: WORKSPACE_BACKUP_VERSION,
        createdAt: new Date().toISOString(), dashboards: cloneJson(dashboards), folders: cloneJson(folders),
    };
    validateBackup(backup);
    if (new Blob([JSON.stringify(backup)]).size > MAX_WORKSPACE_BACKUP_BYTES) {
        throw new Error('Workspace backup exceeds the 5 MB limit. No data was exported.');
    }
    return backup;
}

export function parseWorkspaceBackup(raw: string): WorkspaceBackup {
    if (new Blob([raw]).size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace backup exceeds the 5 MB import limit.');
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error('The selected file is not valid JSON. No workspaces were imported.');
    }
    validateBackup(value);
    return value;
}

export function previewWorkspaceBackup(backup: WorkspaceBackup): WorkspaceBackupPreview {
    validateBackup(backup);
    return {
        dashboards: backup.dashboards.length,
        tabs: backup.dashboards.reduce((sum, dashboard) => sum + dashboard.tabs.length, 0),
        widgets: backup.dashboards.reduce((sum, dashboard) => sum + dashboard.tabs.reduce((count, tab) => count + tab.widgets.length, 0), 0),
        syncGroups: backup.dashboards.reduce((sum, dashboard) => sum + dashboard.syncGroups.length, 0),
        folders: backup.folders.length,
        dashboardNames: backup.dashboards.map((dashboard) => dashboard.name),
        folderNames: backup.folders.map((folder) => folder.name),
        exclusions: WORKSPACE_BACKUP_EXCLUSIONS,
    };
}

export function importWorkspaceBackup(state: DashboardState, backup: WorkspaceBackup, makeId: () => string = () => crypto.randomUUID()): DashboardState {
    validateBackup(backup);
    const existing = new Set([
        ...state.folders.map((folder) => folder.id),
        ...state.dashboards.flatMap((dashboard) => [dashboard.id, ...dashboard.tabs.flatMap((tab) => [tab.id, ...tab.widgets.flatMap((widget) => [widget.id, widget.layout.i])])]),
    ]);
    const nextId = (prefix: string) => {
        let id: string;
        do { id = `${prefix}${makeId()}`; } while (existing.has(id));
        existing.add(id);
        return id;
    };
    const folderIds = new Map(backup.folders.map((folder) => [folder.id, nextId('folder-import-')]));
    const folders = backup.folders.map((folder) => ({ ...folder, id: folderIds.get(folder.id)!, parentId: folder.parentId ? folderIds.get(folder.parentId)! : undefined }));
    const dashboards = backup.dashboards.map((dashboard) => {
        const groupIds = new Map(dashboard.syncGroups.map((group, index) => [group.id, index + 1]));
        return {
            ...dashboard,
            id: nextId('import-'),
            folderId: dashboard.folderId ? folderIds.get(dashboard.folderId)! : undefined,
            isDefault: false,
            isEditable: true,
            isDeletable: true,
            widgetGroups: cloneJson(dashboard.widgetGroups!),
            tabs: dashboard.tabs.map((tab) => {
                const tabId = nextId('tab-import-');
                return { ...tab, id: tabId, widgets: tab.widgets.map((widget) => {
                    const widgetId = nextId('widget-import-');
                    const canonicalType = normalizeWidgetType(widget.type) ?? widget.type;
                    return {
                        ...widget, id: widgetId, tabId, type: canonicalType,
                        config: cloneJson(widget.config),
                        syncGroupId: widget.syncGroupId === undefined ? undefined : groupIds.get(widget.syncGroupId)!,
                        layout: { ...widget.layout, i: widget.layout.i === widget.id ? widgetId : nextId('layout-import-') },
                    };
                }) };
            }),
            syncGroups: dashboard.syncGroups.map((group) => ({ ...group, id: groupIds.get(group.id)! })),
        };
    });
    return { ...state, folders: [...state.folders, ...folders], dashboards: [...state.dashboards, ...dashboards] };
}
