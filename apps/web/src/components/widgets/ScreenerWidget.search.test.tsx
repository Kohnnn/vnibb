import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { formatAbsoluteTimestamp } from '@/lib/format';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ScreenerResponse } from '@/types/screener';
import { useScreenerData } from '@/lib/queries';
import { ScreenerWidget } from './ScreenerWidget';

jest.mock('@/lib/queries', () => ({
  useScreenerData: jest.fn(),
  useVnstockSource: () => 'VCI',
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
jest.mock('@/components/ui/WidgetMeta', () => jest.requireActual('@/components/ui/WidgetMeta'));
jest.mock('@/components/ui/VirtualizedTable', () => ({ VirtualizedTable: () => <div>Stocks table</div> }));

const mockUseScreenerData = jest.mocked(useScreenerData);

beforeEach(() => {
  widgetConfig = {};
  widgets.length = 0;
  widgets.push({ id: 'screener-1', type: 'screener', config: widgetConfig });
  updateWidget.mockReset();
  mockUseScreenerData.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<ScreenerResponse>);
});

test('shows the observation date separately from fetch time after a fresh request', () => {
  const observationDate = '2026-10-19';
  const fetchedAt = Date.parse('2026-10-21T10:00:00Z');
  mockUseScreenerData.mockReturnValue({
    data: { data: [], meta: { last_data_date: observationDate } },
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: fetchedAt,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<ScreenerResponse>);

  render(<ScreenerWidget id="screener-1" config={widgetConfig} />);

  expect(screen.getByText(`As of ${formatAbsoluteTimestamp(new Date(observationDate))}`)).toBeInTheDocument();
  expect(screen.getByText(`Fetched ${formatAbsoluteTimestamp(new Date(fetchedAt))}`)).toBeInTheDocument();
});

test('resetting columns persists the selection without restoring the previous columns', () => {
  function PersistedScreener() {
    const [config, setConfig] = useState<Record<string, unknown>>({ activeColumns: ['ticker', 'price', 'change_1d', 'market_cap', 'pe', 'dividend_yield'] });
    widgets[0].config = config;
    updateWidget.mockImplementation((_dashboardId, _tabId, _widgetId, updates) => {
      setConfig(updates.config);
    });
    return <ScreenerWidget id="screener-1" config={config} />;
  }

  const view = render(<PersistedScreener />);
  fireEvent.click(screen.getByTitle('Customize Columns'));
  fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));

  expect(screen.getByLabelText('Filter screener results')).toBeInTheDocument();
  const requestedColumns = mockUseScreenerData.mock.calls.at(-1)?.[0]?.columns?.split(',');
  expect(requestedColumns).toContain('pb');
  expect(widgets[0].config.activeColumns).toEqual(requestedColumns);
  view.unmount();
  updateWidget.mockReset();
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

test('a pending local search echo never rewrites the live typing buffer', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={{ search: '' }} />);
  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'VC' } });
  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'VCB' } });
  rerender(<ScreenerWidget id="screener-1" config={{ search: 'VC' }} />);
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

test('an external persisted search replaces the live buffer without writing the old search back', () => {
  widgetConfig = { search: 'OLD' };
  widgets[0].config = widgetConfig;
  const { rerender } = render(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  updateWidget.mockClear();

  widgetConfig = { search: 'FPT' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);

  expect(screen.getByLabelText('Filter screener results')).toHaveValue('FPT');
  expect(updateWidget.mock.calls.some(([, , , updates]) => updates.config.search === 'OLD')).toBe(false);

  updateWidget.mockClear();
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(updateWidget.mock.calls.some(([, , , updates]) => updates.config.search === 'OLD')).toBe(false);
});

test('a remote clear after a remote search remains clear', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  widgetConfig = { search: 'FPT' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('FPT');

  updateWidget.mockClear();
  widgetConfig = { search: '' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('');
  expect(updateWidget.mock.calls.some(([, , , updates]) => updates.config.search === 'FPT')).toBe(false);
});

test('a local search echo is ignored while a later external search is adopted', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  const input = screen.getByLabelText('Filter screener results');
  fireEvent.change(input, { target: { value: 'VC' } });
  fireEvent.change(input, { target: { value: 'VCB' } });

  widgetConfig = { search: 'VC' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(input).toHaveValue('VCB');

  updateWidget.mockClear();
  widgetConfig = { search: 'FPT' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(input).toHaveValue('FPT');
  expect(updateWidget.mock.calls.some(([, , , updates]) => updates.config.search === 'VCB')).toBe(false);
});

test('typing after an external search persists the new local search', () => {
  widgetConfig = { search: 'OLD' };
  widgets[0].config = widgetConfig;
  const { rerender } = render(<ScreenerWidget id="screener-1" config={widgetConfig} />);

  widgetConfig = { search: 'FPT' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  updateWidget.mockClear();

  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'FPTC' } });
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('FPTC');
  expect(updateWidget).toHaveBeenCalledWith(
    'workspace',
    'tab',
    'screener-1',
    expect.objectContaining({ config: expect.objectContaining({ search: 'FPTC' }) }),
  );
});

test('a delayed local echo cannot undo a newer external search', () => {
  const { rerender } = render(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  fireEvent.change(screen.getByLabelText('Filter screener results'), { target: { value: 'VCB' } });

  widgetConfig = { search: 'FPT' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('FPT');

  widgetConfig = { search: 'VCB' };
  widgets[0].config = widgetConfig;
  rerender(<ScreenerWidget id="screener-1" config={widgetConfig} />);
  expect(screen.getByLabelText('Filter screener results')).toHaveValue('FPT');
});
