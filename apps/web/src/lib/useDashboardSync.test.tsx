import { act, render, waitFor } from '@testing-library/react';
import type { Dashboard, DashboardState } from '@/types/dashboard';
import { useDashboardSync } from './useDashboardSync';
import * as api from '@/lib/api';
import { probeBackendReadiness } from '@/lib/backendHealth';

jest.mock('@/lib/api', () => ({
  createDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  updateDashboard: jest.fn(),
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
}: {
  dashboardState: DashboardState;
  onSuccess: jest.Mock;
  onDashboardIdReconciled?: jest.Mock;
}) {
  useDashboardSync(dashboardState, { enabled: true, onSyncSuccess: onSuccess, onDashboardIdReconciled });
  return null;
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

  it('reconciles a created dashboard with edits made while creation was pending', async () => {
    const onSuccess = jest.fn();
    const onDashboardIdReconciled = jest.fn();
    const created = deferred<Dashboard>();
    const local = dashboard('dash-new');
    const edited: Dashboard = {
      ...local,
      name: 'Edited dashboard',
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
        syncGroups: [],
        showGroupLabels: true,
        folderId: undefined,
        order: 0,
      },
    }));
  });
});
