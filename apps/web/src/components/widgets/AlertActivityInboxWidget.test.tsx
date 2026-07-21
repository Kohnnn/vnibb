import { fireEvent, render, screen } from '@testing-library/react';

import { AlertActivityInboxWidget } from './AlertActivityInboxWidget';
import { readAlertActivity, recordAlertActivity } from '@/lib/alertActivity';

const setLinkedSymbol = jest.fn();

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
}));

describe('AlertActivityInboxWidget', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLinkedSymbol.mockClear();
  });

  it('marks activity read and opens a normalized linked symbol', () => {
    recordAlertActivity({
      id: 'price:1',
      source: 'price',
      triggerTime: '2026-07-20T00:00:00Z',
      deliveryClass: 'browser_local',
      serverBacked: false,
      title: 'Price trigger',
      symbol: ' fpt ',
    });

    render(<AlertActivityInboxWidget id="activity" widgetGroup="A" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open FPT from Price trigger' }));

    expect(setLinkedSymbol).toHaveBeenCalledWith('FPT');
    expect(readAlertActivity()[0]).toEqual(expect.objectContaining({ read: true }));
    expect(screen.getByText(/browser-local record/)).toBeInTheDocument();
  });

  it('marks symbol-less activity read without navigation', () => {
    recordAlertActivity({
      id: 'saved:1',
      source: 'saved_screen',
      triggerTime: '2026-07-20T00:00:00Z',
      deliveryClass: 'polled',
      serverBacked: false,
      title: 'Saved-screen trigger',
    });

    render(<AlertActivityInboxWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Saved-screen trigger read' }));

    expect(setLinkedSymbol).not.toHaveBeenCalled();
    expect(readAlertActivity()[0]).toEqual(expect.objectContaining({ read: true }));
  });
});
