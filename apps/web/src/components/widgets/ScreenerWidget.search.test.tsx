import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ScreenerResponse } from '@/types/screener';
import { useScreenerData } from '@/lib/queries';
import { ScreenerWidget } from './ScreenerWidget';

jest.mock('@/lib/queries', () => ({
  useScreenerData: jest.fn(),
  useVnstockSource: () => 'KBS',
}));
jest.mock('@/lib/alertActivity', () => ({ recordAlertActivity: jest.fn() }));

const updateWidget = jest.fn();
let widgetConfig: Record<string, unknown> = {};
const widgets: Array<{ id: string; type: string; config: Record<string, unknown> }> = [];

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: {
      dashboards: [{
        id: 'workspace',
        tabs: [{ id: 'tab', widgets }],
      }],
    },
    activeDashboard: { id: 'workspace' },
    activeTab: { id: 'tab' },
    addWidget: jest.fn(),
    createDashboard: jest.fn(),
    createTab: jest.fn(),
    updateWidget,
  }),
}));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }));
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/VirtualizedTable', () => ({ VirtualizedTable: () => <div>Stocks table</div> }));

const mockUseScreenerData = jest.mocked(useScreenerData);

beforeEach(() => {
  widgetConfig = {};
  widgets.length = 0;
  widgets.push({ id: 'screener-1', type: 'screener', config: widgetConfig });
  updateWidget.mockClear();
  mockUseScreenerData.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<ScreenerResponse>);
});


test('typing keeps the live buffer and the persisted search in lockstep', async () => {
  render(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  const input = screen.getByLabelText('Filter screener results');
  fireEvent.change(input, { target: { value: 'VCB' } });
  expect(input).toHaveValue('VCB');

  await waitFor(() => expect(updateWidget).toHaveBeenCalledWith(
    'workspace',
    'tab',
    'screener-1',
    expect.objectContaining({ config: expect.objectContaining({ search: 'VCB' }) }),
  ));
});

test('a late persisted echo never rewrites the live typing buffer', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={{ search: '' }} />);
  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'VCB' } });
  rerender(<ScreenerWidget id="screener-1" config={{ search: 'VC' }} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('VCB');
  rerender(<ScreenerWidget id="screener-1" config={{ search: '' }} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('VCB');
});

test('a widget instance change adopts the persisted search exactly once', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={{ search: '' }} />);
  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'HPG' } });
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('HPG');

  widgets.push({ id: 'screener-2', type: 'screener', config: { search: 'FPT' } });
  rerender(<><ScreenerWidget id="screener-1" config={{ search: 'HPG' }} /><ScreenerWidget id="screener-2" config={{ search: 'FPT' }} /></>);
  const inputs = screen.getAllByLabelText('Filter screener results');
  expect(inputs[0]).toHaveValue('HPG');
  expect(inputs[1]).toHaveValue('FPT');
});
