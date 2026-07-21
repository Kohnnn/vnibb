import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Dashboard, SystemDashboardTemplateListResponse } from '@/types/dashboard';
import {
  DashboardProvider,
  useDashboard,
} from './index';
import {
  CURRENT_MIGRATION_VERSION,
  CURRENT_STORAGE_VERSION,
  DASHBOARD_RECOVERY_BACKUP_KEY,
  DASHBOARD_STORAGE_COMMIT_KEY,
  FOLDERS_KEY,
  LAST_VIEW_STATE_KEY,
  MIGRATION_VERSION_KEY,
  STORAGE_KEY,
  STORAGE_VERSION_KEY,
} from './constants';
import { getPublishedSystemDashboardTemplates } from '@/lib/api';
import { useDashboardSync, useLoadFromBackend } from '@/lib/useDashboardSync';
import { config } from '@/lib/config';

jest.mock('@/lib/api', () => ({
  getPublishedSystemDashboardTemplates: jest.fn(),
}));

jest.mock('@/lib/useDashboardSync', () => ({
  useDashboardSync: jest.fn(),
  useLoadFromBackend: jest.fn(),
}));

const customDashboard: Dashboard = {
  id: 'custom-restored-dashboard',
  name: 'Restored custom dashboard',
  order: 10,
  isDefault: false,
  isEditable: true,
  isDeletable: true,
  showGroupLabels: true,
  tabs: [],
  syncGroups: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

function DashboardStateProbe() {
  const { createDashboard, migrationNotice, setActiveDashboard, setActiveTab, state } = useDashboard();

  return (
    <>
      <output data-testid="dashboards">{state.dashboards.map((dashboard) => `${dashboard.id}:${dashboard.name}`).join(',')}</output>
      <output data-testid="dashboard-count">{state.dashboards.length}</output>
      <output data-testid="widget-types">{state.dashboards.flatMap((dashboard) => dashboard.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.type))).join(',')}</output>
      <output data-testid="active-dashboard">{state.activeDashboardId}</output>
      <output data-testid="folder-names">{state.folders.map((folder) => folder.name).join(',')}</output>
      <output data-testid="sync-groups">{state.dashboards.flatMap((dashboard) => dashboard.syncGroups.map((group) => `${group.id}:${group.name}:${group.color}:${group.currentSymbol}`)).join(',')}</output>
      <output data-testid="storage-notice">{migrationNotice?.message || ''}</output>
      <button onClick={() => createDashboard({ name: 'Unsaved dashboard' })}>create dashboard</button>
      <button onClick={() => { setActiveDashboard(customDashboard.id); setActiveTab('saved-tab'); }}>open saved tab</button>
    </>
  );
}

function renderProvider() {
  render(
    <DashboardProvider>
      <DashboardStateProbe />
    </DashboardProvider>,
  );
}

function storedDashboards(): Dashboard[] {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as Dashboard[];
}

describe('DashboardProvider backend sync flag', () => {
  const mockGetPublishedSystemDashboardTemplates = jest.mocked(getPublishedSystemDashboardTemplates);
  const mockUseDashboardSync = jest.mocked(useDashboardSync);
  const mockUseLoadFromBackend = jest.mocked(useLoadFromBackend);
  const originalBackendSyncEnabled = config.backendSyncEnabled;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
    mockGetPublishedSystemDashboardTemplates.mockResolvedValue({ count: 0, data: [] });
    window.localStorage.clear();
  });

  afterEach(() => {
    (config as { backendSyncEnabled: boolean }).backendSyncEnabled = originalBackendSyncEnabled;
    jest.clearAllMocks();
  });

  it.each([false, true])('passes the opt-in state %s to backend hooks after local restoration', async (enabled) => {
    (config as { backendSyncEnabled: boolean }).backendSyncEnabled = enabled;
    renderProvider();

    await waitFor(() => expect(mockUseDashboardSync).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled }),
    ));
    expect(mockUseLoadFromBackend).toHaveBeenLastCalledWith(expect.any(Function), enabled);
  });
});

describe('DashboardProvider published templates', () => {
  const mockGetPublishedSystemDashboardTemplates = jest.mocked(getPublishedSystemDashboardTemplates);

  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([customDashboard]));
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([]));
    window.localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
    window.localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['an empty response', () => mockGetPublishedSystemDashboardTemplates.mockResolvedValue({ count: 0, data: [] })],
    ['a rejected request', () => mockGetPublishedSystemDashboardTemplates.mockRejectedValue(new Error('unavailable'))],
  ])('keeps a restored custom dashboard after %s', async (_scenario, mockResponse) => {
    mockResponse();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderProvider();

    await waitFor(() => expect(mockGetPublishedSystemDashboardTemplates).toHaveBeenCalledTimes(1));

    expect(storedDashboards()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customDashboard.id, name: customDashboard.name }),
    ]));

    warnSpy.mockRestore();
  });

  it('applies a published system template without replacing a restored custom dashboard', async () => {
    const publishedTemplate: Dashboard = {
      ...customDashboard,
      id: 'default-fundamental',
      name: 'Published Fundamental',
      isEditable: false,
      tabs: [{ id: 'published-tab', name: 'Published Overview', order: 0, widgets: [] }],
    };
    const response: SystemDashboardTemplateListResponse = {
      count: 1,
      data: [{
        dashboard_key: 'fundamental',
        status: 'published',
        version: 1,
        dashboard: publishedTemplate,
        updated_at: '2026-07-14T00:00:00.000Z',
      }],
    };
    mockGetPublishedSystemDashboardTemplates.mockResolvedValue(response);

    renderProvider();

    await waitFor(() => expect(storedDashboards().find((dashboard) => dashboard.id === 'default-fundamental')).toEqual(
      expect.objectContaining({ tabs: publishedTemplate.tabs }),
    ));

    expect(storedDashboards()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customDashboard.id, name: customDashboard.name }),
    ]));
  });
});

describe('DashboardProvider browser persistence', () => {
  const mockGetPublishedSystemDashboardTemplates = jest.mocked(getPublishedSystemDashboardTemplates);

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
    mockGetPublishedSystemDashboardTemplates.mockResolvedValue({ count: 0, data: [] });
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([customDashboard]));
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([{ id: 'folder-remote', name: 'Local folder', order: 1, isExpanded: true }]));
    window.localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
    window.localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('preserves the active tab for each dashboard during atomic persistence', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{
      ...customDashboard,
      tabs: [{ id: 'saved-tab', name: 'Saved tab', order: 0, widgets: [] }],
    }]));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));

    fireEvent.click(screen.getByRole('button', { name: 'open saved tab' }));

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(LAST_VIEW_STATE_KEY) ?? '{}')).toEqual(expect.objectContaining({
      activeDashboardId: customDashboard.id,
      lastActiveTabIdByDashboard: expect.objectContaining({ [customDashboard.id]: 'saved-tab' }),
    })));
  });

  it('keeps memory and last-good storage when dashboard persistence fails', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const lastGoodDashboards = window.localStorage.getItem(STORAGE_KEY);
    const originalSetItem = Storage.prototype.setItem;
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole('button', { name: 'create dashboard' }));

    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('6'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(lastGoodDashboards);
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard changes are not saved in this browser');
    setItem.mockRestore();
  });

  it('keeps memory and last-good storage when dashboard serialization fails', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const lastGoodDashboards = window.localStorage.getItem(STORAGE_KEY);
    const originalStringify = JSON.stringify;
    const stringify = jest.spyOn(JSON, 'stringify');
    stringify.mockImplementation((value, replacer, space) => {
      if (Array.isArray(value) && value.some((dashboard) => dashboard?.name === 'Unsaved dashboard')) {
        throw new TypeError('circular dashboard');
      }
      return originalStringify(value, replacer, space);
    });

    fireEvent.click(screen.getByRole('button', { name: 'create dashboard' }));

    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('6'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(lastGoodDashboards);
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard changes are not saved in this browser');
  });

  it.each([
    ['malformed sync groups', { ...customDashboard, syncGroups: [{ id: 1, name: 'Peers', color: '#3B82F6' }] }],
    ['a nested malformed widget layout', {
      ...customDashboard,
      tabs: [{
        id: 'invalid-initial-tab',
        name: 'Initial',
        order: 0,
        widgets: [{
          id: 'invalid-initial-widget',
          tabId: 'invalid-initial-tab',
          type: 'ticker_info',
          config: {},
          layout: { i: 'invalid-initial-widget', x: 0, y: 0, w: 'invalid', h: 1 },
        }],
      }],
    }],
  ])('backs up and resets %s on initial load', async (_scenario, dashboard) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([dashboard]));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('4'));
    expect(screen.getByTestId('dashboards')).not.toHaveTextContent(customDashboard.id);
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard storage was corrupted and has been reset');
    expect(window.localStorage.getItem(DASHBOARD_RECOVERY_BACKUP_KEY)).toContain(customDashboard.id);
  });

  it('loads a valid legacy migration on initial load', async () => {
    const legacyDashboard: Dashboard = {
      ...customDashboard,
      id: 'legacy-initial-dashboard',
      tabs: [{
        id: 'legacy-initial-tab',
        name: 'Initial',
        order: 0,
        widgets: [{
          id: 'legacy-initial-widget',
          tabId: 'legacy-initial-tab',
          type: 'company_profile',
          config: {},
          layout: { i: 'legacy-initial-widget', x: 0, y: 0, w: 8, h: 4 },
        }],
      }],
    } as unknown as Dashboard;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([legacyDashboard]));
    window.localStorage.setItem(MIGRATION_VERSION_KEY, '6');

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('dashboards')).toHaveTextContent(legacyDashboard.id));
    expect(screen.getByTestId('widget-types')).toHaveTextContent('ticker_profile');
  });

  it('loads a coherent dashboard, folder, and active-dashboard snapshot from another tab', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const remoteDashboard: Dashboard = { ...customDashboard, id: 'remote-dashboard', name: 'Remote dashboard' };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([remoteDashboard]));
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([{ id: 'folder-remote', name: 'Remote folder', order: 0, isExpanded: true }]));
    window.localStorage.setItem(LAST_VIEW_STATE_KEY, JSON.stringify({ activeDashboardId: remoteDashboard.id, lastActiveTabIdByDashboard: {} }));

    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: window.localStorage.getItem(STORAGE_KEY) }));
    act(() => jest.advanceTimersByTime(100));

    await waitFor(() => expect(screen.getByTestId('active-dashboard')).toHaveTextContent(remoteDashboard.id));
    expect(storedDashboards()).toEqual(expect.arrayContaining([expect.objectContaining({ id: remoteDashboard.id })]));
    expect(screen.getByTestId('folder-names')).toHaveTextContent('Remote folder');
  });

  it.each([
    ['a malformed tab', { ...customDashboard, tabs: [{ id: 'remote-tab', name: 'Remote', order: 0, widgets: 'invalid' }] }],
    ['a malformed widget', { ...customDashboard, tabs: [{ id: 'remote-tab', name: 'Remote', order: 0, widgets: [{ id: 'widget', tabId: 'remote-tab', type: 'invalid', config: {}, layout: { i: 'widget', x: 0, y: 0, w: 1, h: 1 } }] }] }],
    ['a malformed layout', { ...customDashboard, tabs: [{ id: 'remote-tab', name: 'Remote', order: 0, widgets: [{ id: 'widget', tabId: 'remote-tab', type: 'ticker_info', config: {}, layout: { i: 'widget', x: Number.NaN, y: 0, w: 1, h: 1 } }] }] }],
  ])('keeps current state for %s remote state', async (_scenario, remoteDashboard) => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([remoteDashboard]));
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: window.localStorage.getItem(STORAGE_KEY) }));
    act(() => jest.advanceTimersByTime(100));

    expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5');
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard storage was corrupted and has been reset');
  });

  it('loads a normalized legacy remote snapshot', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const remoteDashboard: Dashboard = {
      ...customDashboard,
      id: 'legacy-remote-dashboard',
      tabs: [{
        id: 'legacy-remote-tab',
        name: 'Remote',
        order: 0,
        widgets: [{
          id: 'legacy-widget',
          tabId: 'legacy-remote-tab',
          type: 'company_profile',
          config: {},
          layout: { i: 'legacy-widget', x: 0, y: 0, w: 8, h: 4 },
        }],
      }],
    } as unknown as Dashboard;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([remoteDashboard]));
    window.localStorage.setItem(LAST_VIEW_STATE_KEY, JSON.stringify({ activeDashboardId: remoteDashboard.id, lastActiveTabIdByDashboard: { [remoteDashboard.id]: 'legacy-remote-tab' } }));
    window.localStorage.setItem(MIGRATION_VERSION_KEY, '6');
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: window.localStorage.getItem(STORAGE_KEY) }));
    act(() => jest.advanceTimersByTime(100));

    await waitFor(() => expect(screen.getByTestId('active-dashboard')).toHaveTextContent(remoteDashboard.id));
    expect(screen.getByTestId('widget-types')).toHaveTextContent('ticker_profile');
  });

  it.each([FOLDERS_KEY, LAST_VIEW_STATE_KEY])('restores every related key when persistence fails at %s', async (failedKey) => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const previous = Object.fromEntries([STORAGE_KEY, FOLDERS_KEY, LAST_VIEW_STATE_KEY, DASHBOARD_STORAGE_COMMIT_KEY].map((key) => [key, window.localStorage.getItem(key)]));
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failedKey && !failed) {
        failed = true;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole('button', { name: 'create dashboard' }));

    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('6'));
    for (const [key, value] of Object.entries(previous)) {
      expect(window.localStorage.getItem(key)).toBe(value);
    }
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard changes are not saved in this browser');
    setItem.mockRestore();
  });

  it('leaves a pending marker when rollback fails so a loader rejects the partial snapshot', async () => {
    const { unmount } = render(
      <DashboardProvider>
        <DashboardStateProbe />
      </DashboardProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const originalSetItem = Storage.prototype.setItem;
    let dashboardWrites = 0;
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === LAST_VIEW_STATE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      if (key === STORAGE_KEY && ++dashboardWrites === 2) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole('button', { name: 'create dashboard' }));

    await waitFor(() => expect(window.localStorage.getItem(DASHBOARD_STORAGE_COMMIT_KEY)).toBe('pending'));
    setItem.mockRestore();
    unmount();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('4'));
    expect(screen.getByTestId('dashboards')).not.toHaveTextContent(customDashboard.id);
  });

  it('loads a remote dashboard with valid sync groups', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const remoteDashboard: Dashboard = {
      ...customDashboard,
      id: 'remote-sync-groups',
      syncGroups: [{ id: 1, name: 'Peers', color: '#3B82F6', currentSymbol: 'VNM' }],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([remoteDashboard]));
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([]));
    window.localStorage.setItem(DASHBOARD_STORAGE_COMMIT_KEY, 'committed');
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: window.localStorage.getItem(STORAGE_KEY) }));
    act(() => jest.advanceTimersByTime(100));

    await waitFor(() => expect(screen.getByTestId('sync-groups')).toHaveTextContent('1:Peers:#3B82F6:VNM'));
  });

  it.each([
    null,
    {},
    [{ id: 1, name: 'Peers', color: '#3B82F6' }],
    [{ id: 1, name: 'Peers', color: '#3B82F6', currentSymbol: 'VNM' }, null],
  ])('ignores malformed remote sync groups without crashing', async (syncGroups) => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    const remoteDashboard = { ...customDashboard, id: 'invalid-remote-sync-groups', syncGroups };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([remoteDashboard]));
    window.localStorage.setItem(DASHBOARD_STORAGE_COMMIT_KEY, 'committed');
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: window.localStorage.getItem(STORAGE_KEY) }));
    act(() => jest.advanceTimersByTime(100));

    expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5');
    expect(screen.getByTestId('storage-notice')).toHaveTextContent('Dashboard storage was corrupted and has been reset');
  });

  it('ignores malformed remote state and clears its storage debounce on unmount', async () => {
    const { unmount } = render(
      <DashboardProvider>
        <DashboardStateProbe />
      </DashboardProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5'));
    window.localStorage.setItem(STORAGE_KEY, '{');
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: '{' }));
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByTestId('dashboard-count')).toHaveTextContent('5');

    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: '{' }));
    unmount();
    act(() => jest.advanceTimersByTime(100));
  });
});
