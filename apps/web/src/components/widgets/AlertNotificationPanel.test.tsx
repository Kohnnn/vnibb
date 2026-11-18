import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AlertNotificationPanel } from './AlertNotificationPanel';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { readAlertActivity, recordAlertActivity } from '@/lib/alertActivity';
import type { InsiderAlert } from '@/types/insider';
import { PredictionMarketWatchlistProvider, usePredictionMarketWatchlist } from './prediction-market-ui/PredictionMarketWatchlist';

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

  it('defaults to followed markets while retaining older and unrelated activity behind explicit filters', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-18T04:00:00Z'));
    const common = { source: 'prediction_market', deliveryClass: 'polled', serverBacked: true } as const;
    recordAlertActivity({ ...common, id: 'prediction:polymarket:wti:4h:a:1', triggerTime: '2026-11-18T03:58:00Z', title: 'WTI new movement', detail: 'WTI above 70 dollars' });
    recordAlertActivity({ ...common, id: 'prediction:polymarket:tennis:4h:b:1', triggerTime: '2026-11-18T03:57:00Z', title: 'Unfollowed tennis market', detail: 'Tennis finals' });
    recordAlertActivity({ ...common, id: 'prediction:polymarket:wti:4h:c:1', triggerTime: '2026-10-22T09:00:00Z', title: 'WTI older movement', read: true });
    recordAlertActivity({ id: 'price:wide', source: 'price', triggerTime: '2026-11-18T03:59:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Equity price trigger', symbol: 'FPT' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function FollowFixtureMarket() {
      const { toggle } = usePredictionMarketWatchlist();
      return <button onClick={() => toggle('polymarket:wti')}>Follow WTI fixture</button>;
    }

    try {
      render(<QueryClientProvider client={client}><PredictionMarketWatchlistProvider><FollowFixtureMarket /><AlertNotificationPanel /></PredictionMarketWatchlistProvider></QueryClientProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Follow WTI fixture' }));
      fireEvent.click(screen.getByRole('button', { name: 'Alert activity, 3 unread' }));
      const drawer = screen.getByRole('dialog', { name: 'Alerts' });
      expect(within(drawer).getByText('3 unread')).toBeInTheDocument();
      expect(within(drawer).getByText('WTI new movement')).toBeVisible();
      expect(within(drawer).queryByText('Unfollowed tennis market')).not.toBeInTheDocument();
      expect(within(drawer).queryByText('Equity price trigger')).not.toBeInTheDocument();

      fireEvent.click(within(drawer).getByRole('button', { name: 'Show all' }));
      expect(within(drawer).getByText('WTI older movement')).toBeVisible();
      fireEvent.change(within(drawer).getByRole('combobox', { name: 'Time range' }), { target: { value: '7' } });
      expect(within(drawer).queryByText('WTI older movement')).not.toBeInTheDocument();
      fireEvent.change(within(drawer).getByRole('combobox', { name: 'Alert scope' }), { target: { value: 'all' } });
      expect(within(drawer).getByText('Unfollowed tennis market')).toBeVisible();
      fireEvent.change(within(drawer).getByRole('combobox', { name: 'Alert source' }), { target: { value: 'price' } });
      expect(within(drawer).getByRole('heading', { name: 'Price alerts' })).toBeVisible();
      expect(within(drawer).queryByText('Unfollowed tennis market')).not.toBeInTheDocument();
      fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Symbol or topic' }), { target: { value: 'VNM' } });
      expect(within(drawer).queryByText('Equity price trigger')).not.toBeInTheDocument();
      fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Symbol or topic' }), { target: { value: 'fpt' } });
      expect(within(drawer).getByText('Equity price trigger')).toBeVisible();
    } finally {
      clock.mockRestore();
    }
  });

  it('shows concise source and time, with observation details behind disclosure and linked navigation', async () => {
    recordAlertActivity({ id: 'price:1', source: 'price', triggerTime: '2026-07-20T00:00:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Price trigger', symbol: 'fpt' });
    recordAlertActivity({ id: 'insider:7', source: 'insider', triggerTime: '2026-07-20T01:00:00Z', deliveryClass: 'server_backed', serverBacked: true, title: 'Insider record', symbol: 'vnm', detail: 'Controlled transaction evidence' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Alert activity, 2 unread/ }));
    expect(await screen.findByRole('heading', { name: 'Insider activity' })).toBeVisible();
    expect(screen.queryByText(/server-backed record; delivery unverified/)).not.toBeInTheDocument();
    expect(screen.getByText(/Desktop delivery is not confirmed/)).not.toBeVisible();
    expect(screen.getByText('Controlled transaction evidence')).not.toBeVisible();
    const disclosure = screen.getByText('Details');
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Controlled transaction evidence')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open FPT from Price trigger' }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('FPT');
    expect(readAlertActivity().find((item) => item.id === 'price:1')).toEqual(expect.objectContaining({ read: true }));
  });

  it('marks all retained unread activity, including insider history outside the latest poll', async () => {
    const latest: InsiderAlert = {
      id: 17, alert_type: 'INSIDER_BUY', severity: 'low', symbol: 'VNM', title: 'Latest insider event',
      description: 'Synthetic latest poll', timestamp: '2026-11-18T04:00:00Z', read: false, read_at: null,
    };
    recordAlertActivity({ id: 'insider:9', source: 'insider', triggerTime: '2026-10-22T09:00:00Z', deliveryClass: 'server_backed', serverBacked: true, title: 'Older retained insider event' });
    recordAlertActivity({ id: 'price:retained', source: 'price', triggerTime: '2026-10-22T09:01:00Z', deliveryClass: 'browser_local', serverBacked: false, title: 'Retained price event' });
    getAlerts.mockResolvedValue([latest]);
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AlertNotificationPanel /></QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: 'Alert activity, 3 unread' }));

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(markRead.mock.calls.map(([id]) => id).sort((a, b) => a - b)).toEqual([9, 17]));
    expect(screen.getByRole('button', { name: 'Alert activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all' })).toHaveFocus();
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
