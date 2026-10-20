import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AlertNotificationPanel } from './AlertNotificationPanel';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { readAlertActivity, recordAlertActivity } from '@/lib/alertActivity';
import type { InsiderAlert } from '@/types/insider';

const setLinkedSymbol = jest.fn();

jest.mock('@/lib/api', () => ({ getInsiderAlerts: jest.fn(), markAlertRead: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol }) }));
jest.mock('@/lib/widgetRuntime', () => ({ buildWidgetRuntime: jest.fn((value) => value) }));

const getAlerts = jest.mocked(getInsiderAlerts);
const markRead = jest.mocked(markAlertRead);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
describe('AlertNotificationPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied', requestPermission: jest.fn() } });
    getAlerts.mockResolvedValue([]);
    markRead.mockResolvedValue(undefined as never);
  });

  it('keeps keyboard focus in the labeled alert dialog across filter updates and restores the bell on dismissal', async () => {
    const rects = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
    const user = userEvent.setup();
    recordAlertActivity({ id: 'price:keyboard', source: 'price', triggerTime: '2026-07-20T00:00:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Keyboard trigger' });
    getAlerts.mockRejectedValue(new Error('Insider API unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    try {
      render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);
      const bell = screen.getByRole('button', { name: 'Alert activity, 1 unread' });
      expect(bell).toHaveAttribute('aria-expanded', 'false');
      bell.focus();
      await user.keyboard('{Enter}');

      const dialog = await screen.findByRole('dialog', { name: 'Alerts' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(bell).toHaveAttribute('aria-expanded', 'true');
      expect(bell).toHaveAttribute('aria-controls', dialog.id);
      const close = within(dialog).getByRole('button', { name: 'Close alert activity' });
      await waitFor(() => expect(close).toHaveFocus());
      expect(await within(dialog).findByRole('button', { name: 'Retry' })).toBeEnabled();

      await user.tab();
      const filter = within(dialog).getByRole('button', { name: 'Show all' });
      expect(filter).toHaveFocus();
      await user.keyboard(' ');
      expect(within(dialog).getByRole('button', { name: 'Show unread only' })).toHaveFocus();
      const list = within(dialog).getByRole('region', { name: 'Alert activity list' });
      expect(list).toHaveAttribute('tabindex', '0');
      const activity = within(dialog).getByRole('button', { name: 'Mark Keyboard trigger read' });
      activity.focus();
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(activity).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Alerts' })).not.toBeInTheDocument();
      expect(bell).toHaveFocus();
      expect(bell).toHaveAttribute('aria-expanded', 'false');
      await user.keyboard(' ');
      const reopened = await screen.findByRole('dialog', { name: 'Alerts' });
      expect(reopened.id).toBe(dialog.id);
      expect(within(reopened).getByRole('button', { name: 'Show unread only' })).toBeInTheDocument();
      await user.click(within(reopened).getByRole('button', { name: 'Close alert activity' }));
      expect(screen.queryByRole('dialog', { name: 'Alerts' })).not.toBeInTheDocument();
      expect(bell).toHaveFocus();
    } finally {
      rects.mockRestore();
    }
  });

  it('shows unified activity with truthful delivery wording and linked navigation', async () => {
    recordAlertActivity({ id: 'price:1', source: 'price', triggerTime: '2026-07-20T00:00:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Price trigger', symbol: 'fpt' });
    recordAlertActivity({ id: 'insider:7', source: 'insider', triggerTime: '2026-07-20T01:00:00Z', deliveryClass: 'server_backed', serverBacked: true, title: 'Insider record', symbol: 'vnm' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Alert activity, 2 unread/ }));
    expect(await screen.findByText(/browser local browser observation/)).toBeInTheDocument();
    expect(screen.getByText(/server-backed record; delivery unverified/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open FPT from Price trigger' }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('FPT');
    expect(readAlertActivity().find((item) => item.id === 'price:1')).toEqual(expect.objectContaining({ read: true }));
  });

  it('retries the current filter and recovers while retaining local and cached activity', async () => {
    recordAlertActivity({ id: 'price:1', source: 'price', triggerTime: '2026-07-20T00:00:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Read local trigger', read: true });
    const cached: InsiderAlert = {
      id: 7, alert_type: 'INSIDER_BUY', severity: 'low', symbol: 'VNM',
      title: 'Cached insider record', description: 'Previously observed server activity',
      timestamp: '2026-07-20T01:00:00Z', read: true, read_at: '2026-07-20T02:00:00Z',
    };
    const failedRequest = deferred<InsiderAlert[]>();
    const recoveryRequest = deferred<InsiderAlert[]>();
    const allRequests = [failedRequest, recoveryRequest];
    getAlerts.mockImplementation((options) => options?.unreadOnly
      ? Promise.resolve([])
      : allRequests.shift()!.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['insider-alerts', 1, false], [cached]);
    render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
    expect(await screen.findByText('No alert activity')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('Cached insider record')).toBeInTheDocument();
    expect(screen.getByText('Read local trigger')).toBeInTheDocument();
    await act(async () => { failedRequest.reject(new Error('Insider API unavailable')); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load insider alerts.');
    expect(screen.getByText('Cached insider record')).toBeInTheDocument();
    expect(screen.getByText('Read local trigger')).toBeInTheDocument();
    expect(screen.queryByText('No alert activity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled());
    expect(screen.getByText('Read local trigger')).toBeInTheDocument();
    expect(screen.getByText('Cached insider record')).toBeInTheDocument();
    await act(async () => {
      recoveryRequest.resolve([{ ...cached, id: 8, title: 'Recovered read insider record' }]);
    });

    expect(await screen.findByText('Recovered read insider record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show unread only' })).toBeInTheDocument();
    expect(screen.getByText('Read local trigger')).toBeInTheDocument();
    expect(screen.getByText('Cached insider record')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('does not claim empty coverage on failure and shows an honest empty state after retry succeeds', async () => {
    const failedRequest = deferred<InsiderAlert[]>();
    const recoveryRequest = deferred<InsiderAlert[]>();
    getAlerts.mockReturnValueOnce(failedRequest.promise).mockReturnValueOnce(recoveryRequest.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Alert activity' }));
    await act(async () => { failedRequest.reject(new Error('Insider API unavailable')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load insider alerts.');
    expect(screen.queryByText('No alert activity')).not.toBeInTheDocument();
    expect(screen.queryByText('No observed unread triggers.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByText('No alert activity')).not.toBeInTheDocument();
    await act(async () => { recoveryRequest.resolve([]); });

    expect(await screen.findByText('No alert activity')).toBeInTheDocument();
    expect(screen.getByText('No observed unread triggers.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
