import { deserialize, serialize } from 'node:v8';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext';
import { CURRENT_MIGRATION_VERSION, CURRENT_STORAGE_VERSION, LAST_VIEW_STATE_KEY, MIGRATION_VERSION_KEY, STORAGE_KEY, STORAGE_VERSION_KEY } from '@/contexts/DashboardContext/constants';
import { getPublishedSystemDashboardTemplates } from '@/lib/api';
import { config } from '@/lib/config';
import type { Dashboard } from '@/types/dashboard';

jest.mock('@/lib/api', () => ({ getPublishedSystemDashboardTemplates: jest.fn() }));
jest.mock('@/lib/useDashboardSync', () => ({ useDashboardSync: jest.fn(), useLoadFromBackend: jest.fn() }));
jest.mock('@/components/settings/SettingsModal', () => ({ SettingsModal: () => null }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ getSharedGroups: jest.fn() }) }));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({ appGlobalMarketsSymbol: 'AMEX:SPY' }) }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));

function StateProbe() {
  const { state } = useDashboard();
  return <output data-testid="duplicate-state">{JSON.stringify(state.dashboards)}</output>;
}

it('duplicates authored workspace tabs and widget content without changing the source, including after reload', async () => {
  const previousBackendSync = config.backendSyncEnabled;
  const previousStructuredClone = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  if (!globalThis.structuredClone) {
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: <T,>(value: T): T => deserialize(serialize(value)) });
  }
  Object.assign(config, { backendSyncEnabled: false });
  jest.mocked(getPublishedSystemDashboardTemplates).mockResolvedValue({ count: 0, data: [] });
  const source: Dashboard = {
    id: 'duplicate-source', name: 'Authored workspace', order: 4,
    isDefault: false, isEditable: true, showGroupLabels: true,
    tabs: [{ id: 'authored-tab', name: 'Research', order: 0, widgets: [{
      id: 'authored-widget', tabId: 'authored-tab', type: 'notes', widgetGroup: 'B',
      config: { text: 'Preserve authored content', symbol: 'FPT', tickerScope: 'override' },
      layout: { i: 'authored-widget', x: 2, y: 3, w: 8, h: 7, minW: 2, minH: 4 },
    }] }],
    syncGroups: [{ id: 1, name: 'Research group', color: '#123456', currentSymbol: 'FPT' }],
    createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
  };
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([source]));
  window.localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
  window.localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
  window.localStorage.setItem(LAST_VIEW_STATE_KEY, JSON.stringify({ activeDashboardId: source.id, lastActiveTabIdByDashboard: { [source.id]: 'authored-tab' } }));
  const dashboards = (): Dashboard[] => JSON.parse(screen.getByTestId('duplicate-state').textContent ?? '[]');
  let view = render(<DashboardProvider><Sidebar /><StateProbe /></DashboardProvider>);
  try {
    await screen.findByRole('button', { name: 'Workspace actions for Authored workspace' });
    const original = dashboards().find(dashboard => dashboard.id === source.id)!;
    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Authored workspace' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(dashboards().find(dashboard => dashboard.name === 'Authored workspace (Copy)')?.tabs).toHaveLength(1));
    const copy = dashboards().find(dashboard => dashboard.name === 'Authored workspace (Copy)')!;
    expect(dashboards().find(dashboard => dashboard.id === source.id)).toEqual(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.tabs[0].id).not.toBe(original.tabs[0].id);
    expect(copy.tabs[0].name).toBe(original.tabs[0].name);
    expect(copy.tabs[0].widgets).toHaveLength(1);
    const widget = copy.tabs[0].widgets[0];
    expect(widget.id).not.toBe(original.tabs[0].widgets[0].id);
    expect(widget.tabId).toBe(copy.tabs[0].id);
    expect(widget.layout.i).toBe(widget.id);
    expect(widget.config).toEqual(original.tabs[0].widgets[0].config);
    expect(widget.widgetGroup).toBe('B');
    expect(widget.layout).toEqual({ ...original.tabs[0].widgets[0].layout, i: widget.id });
    expect(copy.syncGroups).toEqual(original.syncGroups);
    expect(copy.showGroupLabels).toBe(true);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toContainEqual(copy));
    view.unmount();
    view = render(<DashboardProvider><Sidebar /><StateProbe /></DashboardProvider>);
    await waitFor(() => expect(dashboards().find(dashboard => dashboard.id === copy.id)).toEqual(copy));
    expect(dashboards().find(dashboard => dashboard.id === source.id)).toEqual(original);
  } finally {
    view.unmount();
    Object.assign(config, { backendSyncEnabled: previousBackendSync });
    if (previousStructuredClone) Object.defineProperty(globalThis, 'structuredClone', previousStructuredClone);
    else Reflect.deleteProperty(globalThis, 'structuredClone');
  }
});
