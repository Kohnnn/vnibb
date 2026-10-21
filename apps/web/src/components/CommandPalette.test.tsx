import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Dashboard } from '@/types/dashboard';
import { CommandPalette } from './CommandPalette';
import { useDashboard } from '@/contexts/DashboardContext';
import type { DashboardContextValue } from '@/contexts/DashboardContext/types';
import { useGlobalMarketsSymbol } from '@/contexts/GlobalMarketsSymbolContext';

let mockTickerResults = [{ symbol: 'NVDA', name: 'Nvidia', type: 'us_stock', tv_symbol: 'NASDAQ:NVDA' }];
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { results: mockTickerResults } }) }));
jest.mock('@/lib/api', () => ({ searchTickers: jest.fn() }));
jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ setGlobalSymbol: jest.fn() }) }));
jest.mock('@/contexts/SymbolLinkContext', () => ({ useSymbolLink: () => ({ setGlobalSymbol: jest.fn() }) }));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: jest.fn() }));

const imported: Dashboard = {
  id: 'imported', name: 'Imported', order: 0, isDefault: false, showGroupLabels: false,
  globalMarketsSymbol: 'NASDAQ:AAPL', tabs: [], syncGroups: [],
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const destination: Dashboard = {
  ...imported, id: 'global-markets', name: 'Global Markets', globalMarketsSymbol: 'AMEX:SPY',
  tabs: [{ id: 'markets-tab', name: 'Global Markets', order: 0, widgets: [] }],
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockTickerResults = [{ symbol: 'NVDA', name: 'Nvidia', type: 'us_stock', tv_symbol: 'NASDAQ:NVDA' }];
  jest.mocked(useGlobalMarketsSymbol).mockReturnValue({
    globalMarketsSymbol: imported.globalMarketsSymbol!, appGlobalMarketsSymbol: 'AMEX:SPY',
    setGlobalMarketsSymbol: jest.fn(), setGlobalMarketsSymbolForDashboard: jest.fn(),
  });
  jest.mocked(useDashboard).mockReturnValue({
    state: { dashboards: [imported, destination], activeDashboardId: imported.id },
    activeDashboard: imported,
    activeTab: null,
    setActiveDashboard: jest.fn(), setActiveTab: jest.fn(),
    createDashboard: jest.fn(), createTab: jest.fn(), updateTab: jest.fn(),
    addWidget: jest.fn(), updateWidget: jest.fn(), updateSyncGroupSymbol: jest.fn(),
  } as unknown as DashboardContextValue);
});

test('Add TradingView Chart Widget updates the Global Markets destination instead of imported source', () => {
  render(<CommandPalette open onOpenChange={jest.fn()} />);
  fireEvent.click(screen.getByRole('option', { name: /Add TradingView Chart Widget/ }));

  const symbols = jest.mocked(useGlobalMarketsSymbol).mock.results[0].value;
  expect(symbols.setGlobalMarketsSymbolForDashboard).toHaveBeenCalledWith('NASDAQ:AAPL', destination);
  expect(symbols.setGlobalMarketsSymbol).not.toHaveBeenCalled();
  const dashboard = jest.mocked(useDashboard).mock.results[0].value;
  expect(dashboard.addWidget).toHaveBeenCalledWith(destination.id, 'markets-tab', expect.objectContaining({
    type: 'tradingview_chart', config: { symbol: 'NASDAQ:AAPL' },
  }));
});

test('selecting a searched ticker updates the Global Markets destination instead of imported source', () => {
  render(<CommandPalette open onOpenChange={jest.fn()} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Command palette search' }), { target: { value: 'NVDA' } });
  fireEvent.click(screen.getByRole('option', { name: /NVDA/ }));
  const symbols = jest.mocked(useGlobalMarketsSymbol).mock.results[0].value;
  expect(symbols.setGlobalMarketsSymbolForDashboard).toHaveBeenCalledWith('NASDAQ:NVDA', destination);
  expect(symbols.setGlobalMarketsSymbol).not.toHaveBeenCalled();
});

test('keyboard and pointer navigation expose the highlighted result and Enter activates it', () => {
  mockTickerResults = [
    { symbol: 'NVDA', name: 'Nvidia', type: 'us_stock', tv_symbol: 'NASDAQ:NVDA' },
    { symbol: 'NVDS', name: 'Nvidia Short ETF', type: 'us_stock', tv_symbol: 'NASDAQ:NVDS' },
    { symbol: 'NVDY', name: 'Nvidia Income ETF', type: 'us_stock', tv_symbol: 'NASDAQ:NVDY' },
  ];
  const onOpenChange = jest.fn();
  render(<CommandPalette open onOpenChange={onOpenChange} />);
  const search = screen.getByRole('combobox', { name: 'Command palette search' });
  fireEvent.change(search, { target: { value: 'NV' } });
  const list = screen.getByRole('listbox');
  const options = within(list).getAllByRole('option');
  expect(search).toHaveAttribute('aria-expanded', 'true');
  expect(search).toHaveAttribute('aria-autocomplete', 'list');
  expect(search).toHaveAttribute('aria-controls', list.id);
  const expectActive = (option: HTMLElement) => {
    expect(option.id).not.toBe('');
    expect(search).toHaveAttribute('aria-activedescendant', option.id);
    expect(within(list).getAllByRole('option', { selected: true })).toEqual([option]);
    expect(option).toHaveAttribute('tabindex', '-1');
  };
  expectActive(options[0]);
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expectActive(options[2]);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expectActive(options[0]);
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expectActive(options[1]);
  fireEvent.mouseEnter(options[2]);
  expectActive(options[2]);
  fireEvent.keyDown(search, { key: 'Enter' });
  const symbols = jest.mocked(useGlobalMarketsSymbol).mock.results[0].value;
  expect(symbols.setGlobalMarketsSymbolForDashboard).toHaveBeenCalledWith('NASDAQ:NVDY', destination);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('refreshed and empty results keep the active descendant attached to a live option', () => {
  mockTickerResults = [
    { symbol: 'NVDA', name: 'Nvidia', type: 'us_stock', tv_symbol: 'NASDAQ:NVDA' },
    { symbol: 'NVDS', name: 'Nvidia Short ETF', type: 'us_stock', tv_symbol: 'NASDAQ:NVDS' },
    { symbol: 'NVDY', name: 'Nvidia Income ETF', type: 'us_stock', tv_symbol: 'NASDAQ:NVDY' },
  ];
  const onOpenChange = jest.fn();
  const { rerender } = render(<CommandPalette open onOpenChange={onOpenChange} />);
  const search = screen.getByRole('combobox', { name: 'Command palette search' });
  fireEvent.change(search, { target: { value: 'NV' } });
  const lastOption = screen.getAllByRole('option')[2];
  const lastOptionId = lastOption.id;
  fireEvent.mouseEnter(lastOption);
  mockTickerResults = mockTickerResults.slice(2);
  rerender(<CommandPalette open onOpenChange={onOpenChange} />);
  const survivingOption = screen.getByRole('option', { selected: true });
  expect(survivingOption).toHaveAttribute('id', lastOptionId);
  expect(search).toHaveAttribute('aria-activedescendant', survivingOption.id);

  mockTickerResults = [];
  rerender(<CommandPalette open onOpenChange={onOpenChange} />);
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(search).not.toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(search).not.toHaveAttribute('aria-activedescendant');
  expect(onOpenChange).not.toHaveBeenCalled();

  mockTickerResults = [{ symbol: 'NVDA', name: 'Nvidia', type: 'us_stock', tv_symbol: 'NASDAQ:NVDA' }];
  rerender(<CommandPalette open onOpenChange={onOpenChange} />);
  expect(search).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { selected: true }).id);
});

test('Escape after an empty search returns focus to the palette opener', async () => {
  mockTickerResults = [];
  function PaletteWithTrigger() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open palette</button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>;
  }
  render(<PaletteWithTrigger />);
  const trigger = screen.getByRole('button', { name: 'Open palette' });
  trigger.focus();
  fireEvent.click(trigger);
  const search = screen.getByRole('combobox', { name: 'Command palette search' });
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.change(search, { target: { value: 'ZZZZNOTAREALTICKER' } });
  expect(screen.getByText(/No results found/)).toBeInTheDocument();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByRole('combobox', { name: 'Command palette search' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
