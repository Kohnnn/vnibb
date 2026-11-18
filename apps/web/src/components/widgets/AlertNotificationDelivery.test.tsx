import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ContextType } from 'react';

import { AlertNotificationPanel } from './AlertNotificationPanel';
import { DashboardContext } from '@/contexts/DashboardContext';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import type { InsiderAlert } from '@/types/insider';

jest.mock('@/lib/api', () => ({ getInsiderAlerts: jest.fn(), markAlertRead: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }));

const getAlerts = jest.mocked(getInsiderAlerts);
const serverAlert: InsiderAlert = {
  id: 7, alert_type: 'INSIDER_BUY', severity: 'low', symbol: 'VNM',
  title: 'Synthetic insider event', description: 'A controlled alert fixture',
  timestamp: '', read: false, read_at: null,
};
const nativeNotification = jest.fn();
const requestPermission = jest.fn<Promise<NotificationPermission>, []>();
let permission: NotificationPermission;

function renderPanel(extraWidgets: { type: string; config: Record<string, unknown> }[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dashboard = {
    state: { dashboards: [{ tabs: [{ widgets: [
      { type: 'watchlist', config: { watchlistSymbols: ['VNM'] } },
      ...extraWidgets,
    ] }] }] },
  } as ContextType<typeof DashboardContext>;
  const view = render(
    <QueryClientProvider client={client}>
      <DashboardContext.Provider value={dashboard}><AlertNotificationPanel /></DashboardContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  permission = 'default';
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: Object.defineProperties(nativeNotification, {
      permission: { get: () => permission, configurable: true },
      requestPermission: { value: requestPermission, configurable: true },
    }),
  });
  requestPermission.mockImplementation(async () => {
    permission = 'granted';
    return permission;
  });
  getAlerts.mockResolvedValue([]);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'Notification');
});

it('never asks on mount or remount and requests permission only from explicit opt-in', async () => {
  const first = renderPanel();
  await waitFor(() => expect(getAlerts).toHaveBeenCalledTimes(1));
  first.unmount();
  renderPanel();
  await waitFor(() => expect(getAlerts).toHaveBeenCalledTimes(2));
  expect(requestPermission).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
  expect(await screen.findByRole('button', { name: 'Turn off desktop alerts' })).toBeEnabled();
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

it.each(['default', 'denied', 'unsupported'] as const)('keeps synthetic history usable with %s browser permission', async (state) => {
  if (state === 'unsupported') Reflect.deleteProperty(window, 'Notification');
  else permission = state === 'default' ? 'default' : 'denied';
  requestPermission.mockImplementation(async () => { permission = 'denied'; return permission; });
  getAlerts.mockResolvedValue([{ ...serverAlert, timestamp: '2026-10-22T09:00:00Z' }]);
  renderPanel();

  fireEvent.click(await screen.findByRole('button', { name: 'Alert activity, 1 unread' }));
  expect(screen.getByRole('dialog', { name: 'Alerts' })).toBeVisible();
  expect(screen.getByText(serverAlert.title)).toBeVisible();
  expect(requestPermission).not.toHaveBeenCalled();
  if (state === 'default') {
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable desktop alerts' })).not.toBeInTheDocument());
    expect(requestPermission).toHaveBeenCalledTimes(1);
  }
  expect(screen.queryByRole('button', { name: 'Enable desktop alerts' })).not.toBeInTheDocument();
  expect(screen.getByText(serverAlert.title)).toBeVisible();
  expect(nativeNotification).not.toHaveBeenCalled();
});

it('keeps desktop delivery off before opting in and after turning it off, even with browser permission', async () => {
  permission = 'granted';
  const { client } = renderPanel();
  await waitFor(() => expect(getAlerts).toHaveBeenCalled());
  const publish = async (id: number) => {
    const event = { ...serverAlert, id, timestamp: new Date().toISOString() };
    getAlerts.mockResolvedValue([event]);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['insider-alerts'] });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: `Alert activity, ${id} unread` })).toBeInTheDocument());
  };

  await publish(1);
  expect(nativeNotification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Alert activity, 1 unread' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
  await screen.findByRole('button', { name: 'Turn off desktop alerts' });
  await publish(2);
  expect(nativeNotification).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Turn off desktop alerts' }));
  await publish(3);
  expect(nativeNotification).toHaveBeenCalledTimes(1);
  expect(requestPermission).not.toHaveBeenCalled();
});

it('delivers a followed insider ticker only, without discarding unrelated unread history', async () => {
  const start = Date.parse('2026-11-18T04:00:00Z');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
  try {
    // The unrelated ticker has a live price rule and is in a saved scan. Neither matches an insider event.
    const { client } = renderPanel([
      { type: 'price_alerts', config: { alerts: [{
        id: 'hpg-price', symbol: 'HPG', condition: 'above', threshold: 100,
        createdAt: new Date(start - 1000).toISOString(), isActive: true, notificationSent: false,
      }] } },
      { type: 'screener', config: { savedScreens: [{ id: 'quality', alertEnabled: true, alertMatchSymbols: ['HPG'] }] } },
    ]);
    await waitFor(() => expect(getAlerts).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
    await screen.findByRole('button', { name: 'Turn off desktop alerts' });
    expect(requestPermission).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(start + 2000);
    const timestamp = new Date(start + 1000).toISOString();
    const followed = { ...serverAlert, symbol: 'vnm', timestamp, title: 'Followed insider event' };
    const unrelated = { ...serverAlert, id: 8, symbol: 'HPG', timestamp, title: 'Unrelated insider event' };
    getAlerts.mockResolvedValue([followed, unrelated]);
    await act(async () => { await client.refetchQueries({ queryKey: ['insider-alerts'] }); });

    const drawer = within(screen.getByRole('dialog', { name: 'Alerts' }));
    expect(await drawer.findByText(followed.title)).toBeVisible();
    expect(drawer.queryByText(unrelated.title)).not.toBeInTheDocument();
    fireEvent.change(drawer.getByRole('combobox', { name: 'Alert scope' }), { target: { value: 'all' } });
    expect(drawer.getByText(followed.title)).toBeVisible();
    expect(drawer.getByText(unrelated.title)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Alert activity, 2 unread' })).toBeInTheDocument();
    expect(markAlertRead).not.toHaveBeenCalled();
    expect(nativeNotification.mock.calls.map(([title]) => title)).toEqual([followed.title]);
  } finally {
    clock.mockRestore();
  }
});

it('delivers a stable event once across changed payloads, polling and reconnect after remount', async () => {
  permission = 'granted';
  const first = renderPanel();
  await waitFor(() => expect(getAlerts).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
  await screen.findByRole('button', { name: 'Turn off desktop alerts' });

  const event = { ...serverAlert, timestamp: new Date().toISOString() };
  getAlerts.mockResolvedValue([event]);
  await act(async () => { await first.client.refetchQueries({ queryKey: ['insider-alerts'] }); });
  expect(await screen.findByText(event.title)).toBeVisible();
  expect(nativeNotification).toHaveBeenCalledTimes(1);

  const revised = { ...event, description: 'Corrected detail' };
  getAlerts.mockResolvedValue([revised]);
  await act(async () => { await first.client.refetchQueries({ queryKey: ['insider-alerts'] }); });
  await waitFor(() => expect(first.client.getQueryData(['insider-alerts', 1, true])).toEqual([revised]));
  expect(nativeNotification).toHaveBeenCalledTimes(1);

  first.unmount();
  const next = renderPanel();
  await waitFor(() => expect(next.client.getQueryData(['insider-alerts', 1, true])).toEqual([revised]));
  expect(nativeNotification).toHaveBeenCalledTimes(1);
});

it('does not deliver read insider history when opening Show all or when a stale response reports it unread', async () => {
  const start = Date.parse('2026-11-18T03:55:00Z');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
  permission = 'granted';
  try {
    const { client } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
    await screen.findByRole('button', { name: 'Turn off desktop alerts' });

    clock.mockReturnValue(start + 2000);
    const timestamp = new Date(start + 1000).toISOString();
    const read = { ...serverAlert, timestamp, read: true, read_at: timestamp, title: 'Previously read insider event' };
    getAlerts.mockResolvedValue([read]);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText(read.title)).toBeVisible();
    expect(nativeNotification).not.toHaveBeenCalled();

    const unread = { ...serverAlert, id: 8, timestamp, title: 'Fresh unread insider event' };
    getAlerts.mockResolvedValue([{ ...read, read: false, read_at: null }, unread]);
    await act(async () => { await client.refetchQueries({ queryKey: ['insider-alerts'] }); });
    expect(await screen.findByText(unread.title)).toBeVisible();
    expect(nativeNotification.mock.calls.map(([title]) => title)).toEqual([unread.title]);
    expect(screen.getByRole('button', { name: 'Alert activity, 1 unread' })).toBeInTheDocument();
  } finally {
    clock.mockRestore();
  }
});

it('keeps late, malformed and future events in history without sending now or after the clock catches up', async () => {
  const now = Date.parse('2026-11-18T03:55:00Z');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  permission = 'granted';
  try {
    const { client } = renderPanel();
    await waitFor(() => expect(getAlerts).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
    await screen.findByRole('button', { name: 'Turn off desktop alerts' });

    const future = { ...serverAlert, timestamp: '2026-11-18T03:55:30Z', title: 'Future observation' };
    const old = { ...serverAlert, id: 8, timestamp: '2026-10-22T03:55:00Z', title: 'Older unread history' };
    const malformed = { ...serverAlert, id: 9, timestamp: 'unknown', title: 'Observation with unknown time' };
    getAlerts.mockResolvedValue([future, old, malformed]);
    await act(async () => { await client.refetchQueries({ queryKey: ['insider-alerts'] }); });
    for (const event of [future, old, malformed]) expect(await screen.findByText(event.title)).toBeVisible();
    expect(nativeNotification).not.toHaveBeenCalled();

    clock.mockReturnValue(now + 35_000);
    const timely = { ...serverAlert, id: 10, timestamp: '2026-11-18T03:55:34', title: 'New UTC alert' };
    getAlerts.mockResolvedValue([{ ...future, description: 'Reissued future observation' }, timely, old]);
    await act(async () => { await client.refetchQueries({ queryKey: ['insider-alerts'] }); });
    expect(await screen.findByText(timely.title)).toBeVisible();
    expect(nativeNotification.mock.calls.map(([title]) => title)).toEqual([timely.title]);
  } finally {
    clock.mockRestore();
  }
});
