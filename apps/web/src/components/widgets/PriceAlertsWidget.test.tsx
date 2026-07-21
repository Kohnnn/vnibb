import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { isValidAlertThreshold, PriceAlertsWidget } from './PriceAlertsWidget';
import { useWebSocket } from '@/lib/hooks/useWebSocket';

const updateWidget = jest.fn();
let widgetLocation: { dashboardId: string; tabId: string; widget: { config: Record<string, unknown> } } | undefined;

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ updateWidget }),
}));
jest.mock('@/hooks/useDashboardWidget', () => ({
  useDashboardWidget: () => widgetLocation,
}));
jest.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: jest.fn() }));
jest.mock('@/lib/queries', () => ({
  fetchStockQuote: jest.fn(() => new Promise(() => undefined)),
  quoteQueryKey: (symbol: string) => ['quote', symbol],
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) => <div>{message}{action && <button onClick={action.onClick}>{action.label}</button>}</div>,
}));
jest.mock('@/lib/widgetRuntime', () => ({ buildWidgetRuntime: jest.fn((value) => value) }));

const socket = jest.mocked(useWebSocket);

function renderWidget(symbol = 'FPT', alerts: Array<Record<string, unknown>> = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PriceAlertsWidget id="alerts" symbol={symbol} config={{ alerts }} /></QueryClientProvider>);
}

describe('PriceAlertsWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    widgetLocation = undefined;
    socket.mockReturnValue({ isConnected: false, prices: new Map(), lastUpdate: null, marketStatus: null, reconnect: jest.fn() });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied', requestPermission: jest.fn() } });
  });

  it('accepts only positive finite thresholds', () => {
    expect(isValidAlertThreshold('100')).toBe(true);
    expect(isValidAlertThreshold('')).toBe(false);
    expect(isValidAlertThreshold('0')).toBe(false);
    expect(isValidAlertThreshold('-1')).toBe(false);
    expect(isValidAlertThreshold('Infinity')).toBe(false);
    expect(isValidAlertThreshold('NaN')).toBe(false);
  });

  it('seeds the linked symbol only when opening and preserves an open form', () => {
    const view = renderWidget('fpt');
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(screen.getByPlaceholderText('Symbol')).toHaveValue('FPT');
    fireEvent.change(screen.getByPlaceholderText('Symbol'), { target: { value: 'VNM' } });

    view.rerender(<QueryClientProvider client={new QueryClient()}><PriceAlertsWidget id="alerts" symbol="VCI" config={{ alerts: [] }} /></QueryClientProvider>);
    expect(screen.getByPlaceholderText('Symbol')).toHaveValue('VNM');
  });

  it('submits one finite alert and rejects invalid values', () => {
    widgetLocation = { dashboardId: 'dashboard', tabId: 'tab', widget: { config: { alerts: [] } } };
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    const threshold = screen.getByPlaceholderText('Price');
    fireEvent.change(threshold, { target: { value: 'Infinity' } });
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(threshold, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('FPT')).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('names alert actions and keeps them keyboard accessible without hover', () => {
    renderWidget('FPT', [{ id: 'one', symbol: 'FPT', condition: 'above', threshold: 100, createdAt: '2026-07-20T00:00:00Z', isActive: true, notificationSent: false }]);

    expect(screen.getByRole('button', { name: 'Pause FPT alert' })).toHaveClass('min-h-11', 'focus-visible:ring-2');
    expect(screen.getByRole('button', { name: 'Delete FPT alert' })).toHaveClass('min-w-11', 'focus-visible:ring-2');
  });
});
