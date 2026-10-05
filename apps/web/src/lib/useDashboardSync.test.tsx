import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Dashboard, DashboardState } from '@/types/dashboard';
import { useDashboardSync, useLoadFromBackend } from './useDashboardSync';
import * as api from '@/lib/api';
import { probeBackendReadiness } from '@/lib/backendHealth';
import { DEFAULT_GROUPS } from '@/types/widget';
import { createWorkspaceBackup } from './workspaceBackup';

jest.mock('@/lib/api', () => ({
  createDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  updateDashboard: jest.fn(),
  getDashboards: jest.fn(),
}));

jest.mock('@/lib/backendHealth', () => ({
  probeBackendReadiness: jest.fn(),
}));

jest.mock('@/lib/clientLogger', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}));

const mockCreateDashboard = jest.mocked(api.createDashboard);
const mockUpdateDashboard = jest.mocked(api.updateDashboard);
const mockGetDashboards = jest.mocked(api.getDashboards);
const mockProbeBackendReadiness = jest.mocked(probeBackendReadiness);

function dashboard(id: string): Dashboard {
  return {
    id,
    name: 'Local dashboard',
    order: 0,
    isDefault: false,
    isEditable: true,
    isDeletable: true,
    showGroupLabels: true,
    tabs: [],
    syncGroups: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function state(dashboards: Dashboard[]): DashboardState {
  return { dashboards, folders: [], activeDashboardId: null, activeTabId: null };
}

function SyncProbe({
  dashboardState,
  onSuccess,
  onDashboardIdReconciled,
  enabled = true,
}: {
  dashboardState: DashboardState;
  onSuccess: jest.Mock;
  onDashboardIdReconciled?: jest.Mock;
  enabled?: boolean;
}) {
  useDashboardSync(dashboardState, { enabled, onSyncSuccess: onSuccess, onDashboardIdReconciled });
  return null;
}

function LoadProbe({ enabled = true }: { enabled?: boolean }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  useLoadFromBackend(setDashboards, enabled);
  return <output data-testid="loaded-dashboards">{JSON.stringify(dashboards)}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('useDashboardSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockProbeBackendReadiness.mockResolvedValue({ healthOk: true, dataOk: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it.each(['create', 'update'] as const)('preserves native workspace settings through backend %s and reload', async (operation) => {
    const onSuccess = jest.fn();
    const local = createWorkspaceBackup(state([dashboard(operation === 'create' ? 'dash-new' : '42')]), {
      ...DEFAULT_GROUPS,
      global: { ...DEFAULT_GROUPS.global, symbol: 'FPT' },
      A: { ...DEFAULT_GROUPS.A, name: 'Banks', symbol: 'VCB' },
    }, 'NASDAQ:QQQ').dashboards[0];
    mockCreateDashboard.mockResolvedValue({ ...local, id: '42' });
    mockUpdateDashboard.mockResolvedValue(local);
    const view = render(<SyncProbe dashboardState={state([local])} onSuccess={onSuccess} />);

    await waitFor(() => expect(mockProbeBackendReadiness).toHaveBeenCalled());
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cloud'));

    const payload = operation === 'create'
      ? mockCreateDashboard.mock.calls[0][0]
      : mockUpdateDashboard.mock.calls[0][1];
    expect(payload).toEqual({
      name: local.name,
      is_default: local.isDefault,
      layout_config: {
        tabs: local.tabs,
        globalMarketsSymbol: 'NASDAQ:QQQ',
        syncGroups: local.syncGroups,
        widgetGroups: local.widgetGroups,
        showGroupLabels: local.showGroupLabels,
        folderId: undefined,
        order: local.order,
      },
    });
    const stored = JSON.parse(JSON.stringify({ ...payload, id: 42 })) as Dashboard;
    mockGetDashboards.mockResolvedValue({ count: 1, data: [stored] });
    view.unmount();
    render(<LoadProbe />);

    await waitFor(() => expect(screen.getByTestId('loaded-dashboards').textContent).not.toBe('[]'));
    const [loaded] = JSON.parse(screen.getByTestId('loaded-dashboards').textContent!);
    expect(loaded).toEqual(expect.objectContaining({
      id: '42',
      globalMarketsSymbol: 'NASDAQ:QQQ',
      widgetGroups: local.widgetGroups,
      tabs: local.tabs,
      syncGroups: local.syncGroups,
    }));
  });

  it.each([undefined, null, {}])('keeps older dashboard defaults when layout_config is %p', async (layoutConfig) => {
    mockGetDashboards.mockResolvedValue({
      count: 1,
      data: [{ id: 42, name: 'Older dashboard', layout_config: layoutConfig } as unknown as Dashboard],
    });
    render(<LoadProbe />);

    await waitFor(() => expect(screen.getByTestId('loaded-dashboards').textContent).not.toBe('[]'));
    const [loaded] = JSON.parse(screen.getByTestId('loaded-dashboards').textContent!);
    expect(loaded).toEqual(expect.objectContaining({
      id: '42',
      name: 'Older dashboard',
      isDefault: false,
      isEditable: true,
      isDeletable: true,
      showGroupLabels: true,
      order: 0,
      tabs: [],
      syncGroups: [],
    }));
    expect(loaded).not.toHaveProperty('globalMarketsSymbol');
    expect(loaded).not.toHaveProperty('widgetGroups');
  });

  it('does not contact the backend when optional workspace sync and loading are disabled', async () => {
    render(<SyncProbe dashboardState={state([dashboard('dash-local')])} onSuccess={jest.fn()} enabled={false} />);
    render(<LoadProbe enabled={false} />);

    await act(async () => { jest.advanceTimersByTime(2000); });

    expect(mockProbeBackendReadiness).not.toHaveBeenCalled();
    expect(mockCreateDashboard).not.toHaveBeenCalled();
    expect(mockUpdateDashboard).not.toHaveBeenCalled();
    expect(mockGetDashboards).not.toHaveBeenCalled();
    expect(screen.getByTestId('loaded-dashboards').textContent).toBe('[]');
  });

  it('creates a newly created dash-prefixed dashboard in the cloud', async () => {
    const onSuccess = jest.fn();
    mockCreateDashboard.mockResolvedValue({ ...dashboard('42'), id: '42' });
    const view = render(<SyncProbe dashboardState={state([])} onSuccess={onSuccess} />);

    await waitFor(() => expect(mockProbeBackendReadiness).toHaveBeenCalled());
    view.rerender(<SyncProbe dashboardState={state([dashboard('dash-new')])} onSuccess={onSuccess} />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(mockCreateDashboard).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenLastCalledWith('cloud');
  });

  it('reports local persistence when every dashboard is ineligible for cloud sync', async () => {
    const onSuccess = jest.fn();
    const view = render(<SyncProbe dashboardState={state([])} onSuccess={onSuccess} />);

    await waitFor(() => expect(mockProbeBackendReadiness).toHaveBeenCalled());
    view.rerender(<SyncProbe dashboardState={state([dashboard('legacy-local')])} onSuccess={onSuccess} />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('local'));
    expect(mockCreateDashboard).not.toHaveBeenCalled();
  });

  it('never creates, updates or deletes imported local-only dashboards', async () => {
    const onSuccess = jest.fn();
    const imported = createWorkspaceBackup(state([dashboard('import-fresh-id')]), DEFAULT_GROUPS, 'NASDAQ:QQQ').dashboards[0];
    const view = render(<SyncProbe dashboardState={state([imported])} onSuccess={onSuccess} />);
    await waitFor(() => expect(mockProbeBackendReadiness).toHaveBeenCalled());
    await act(async () => { jest.advanceTimersByTime(2000); });
    view.rerender(<SyncProbe dashboardState={state([{ ...imported, name: 'Edited locally' }])} onSuccess={onSuccess} />);
    await act(async () => { jest.advanceTimersByTime(2000); });
    view.rerender(<SyncProbe dashboardState={state([])} onSuccess={onSuccess} />);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(mockCreateDashboard).not.toHaveBeenCalled();
    expect(mockUpdateDashboard).not.toHaveBeenCalled();
    expect(api.deleteDashboard).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenLastCalledWith('local');
  });

  it('reconciles a created dashboard with edits made while creation was pending', async () => {
    const onSuccess = jest.fn();
    const onDashboardIdReconciled = jest.fn();
    const created = deferred<Dashboard>();
    const local = createWorkspaceBackup(state([dashboard('dash-new')]), DEFAULT_GROUPS, 'AMEX:SPY').dashboards[0];
    const edited: Dashboard = {
      ...local,
      name: 'Edited dashboard',
      globalMarketsSymbol: 'NASDAQ:QQQ',
      widgetGroups: {
        ...local.widgetGroups!,
        global: { ...local.widgetGroups!.global, symbol: 'FPT' },
      },
      tabs: [{
        id: 'tab-1',
        name: 'Edited tab',
        order: 0,
        widgets: [{
          id: 'widget-1',
          type: 'ticker_info',
          tabId: 'tab-1',
          config: {} as Dashboard['tabs'][number]['widgets'][number]['config'],
          layout: { i: 'widget-1', x: 1, y: 2, w: 3, h: 4 },
        }],
      }],
    };
    mockCreateDashboard.mockReturnValue(created.promise);
    mockUpdateDashboard.mockResolvedValue(edited);
    const view = render(<SyncProbe dashboardState={state([])} onSuccess={onSuccess} onDashboardIdReconciled={onDashboardIdReconciled} />);

    await waitFor(() => expect(mockProbeBackendReadiness).toHaveBeenCalled());
    view.rerender(<SyncProbe dashboardState={state([local])} onSuccess={onSuccess} onDashboardIdReconciled={onDashboardIdReconciled} />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(mockCreateDashboard).toHaveBeenCalledTimes(1));

    view.rerender(<SyncProbe dashboardState={state([edited])} onSuccess={onSuccess} onDashboardIdReconciled={onDashboardIdReconciled} />);
    await act(async () => {
      created.resolve({ ...local, id: '42' });
      await created.promise;
    });

    await waitFor(() => expect(onDashboardIdReconciled).toHaveBeenCalledWith('dash-new', { ...edited, id: '42' }));
    expect(onSuccess).toHaveBeenLastCalledWith('local');

    view.rerender(<SyncProbe dashboardState={state([{ ...edited, id: '42' }])} onSuccess={onSuccess} onDashboardIdReconciled={onDashboardIdReconciled} />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(mockUpdateDashboard).toHaveBeenCalledWith(42, {
      name: 'Edited dashboard',
      is_default: false,
      layout_config: {
        tabs: edited.tabs,
        globalMarketsSymbol: edited.globalMarketsSymbol,
        syncGroups: [],
        widgetGroups: edited.widgetGroups,
        showGroupLabels: true,
        folderId: undefined,
        order: 0,
      },
    }));
  });
});
