import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AlertNotificationPanel } from './AlertNotificationPanel';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { readAlertActivity, recordAlertActivity } from '@/lib/alertActivity';

const setLinkedSymbol = jest.fn();

jest.mock('@/lib/api', () => ({ getInsiderAlerts: jest.fn(), markAlertRead: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol }) }));
jest.mock('@/lib/widgetRuntime', () => ({ buildWidgetRuntime: jest.fn((value) => value) }));

const getAlerts = jest.mocked(getInsiderAlerts);
const markRead = jest.mocked(markAlertRead);

describe('AlertNotificationPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied', requestPermission: jest.fn() } });
    getAlerts.mockResolvedValue([]);
    markRead.mockResolvedValue(undefined as never);
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
});
