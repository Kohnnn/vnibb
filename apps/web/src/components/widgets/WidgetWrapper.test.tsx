import React, { createContext, useContext, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetWrapper } from './WidgetWrapper';
import { NotesWidget } from './NotesWidget';
import { DEFAULT_GROUPS } from '@/types/widget';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';
let mockTickerOverride: string | null = null;
let mockWidgetConfig: Record<string, unknown> = {};
let mockWidgetType = 'screener';
const mockSetGroupSymbol = jest.fn();
const mockUpdateWidget = jest.fn((_dashboard: string, _tab: string, _id: string, patch: { config?: Record<string, unknown> }) => {
  if (patch.config) mockWidgetConfig = patch.config;
});

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({
    state: { dashboards: [{ id: 'dashboard', isEditable: true, tabs: [{ id: 'tab', widgets: [{ id: 'screener', type: mockWidgetType, layout: { x: 0, y: 0, w: 12, h: 8 }, config: mockWidgetConfig }, { id: 'global-peer', type: 'screener', layout: { x: 0, y: 8, w: 12, h: 8 }, config: {} }] }] }] },
    addWidget: jest.fn(), cloneWidget: jest.fn(), updateWidget: mockUpdateWidget,
  }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({
    groups: DEFAULT_GROUPS,
    getColorForGroup: () => '#fff',
    getSymbolForGroup: (group: string) => group === 'A' ? 'FPT' : 'VCI',
    setGroupSymbol: mockSetGroupSymbol,
    tickerOverrideFor: (id: string) => id === 'screener' ? mockTickerOverride : null,
    setWidgetTickerOverride: (_id: string, symbol: string) => { mockTickerOverride = symbol; },
    clearWidgetTickerOverride: () => { mockTickerOverride = null; },
  }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({ setGlobalMarketsSymbol: jest.fn() }) }));
jest.mock('@/lib/queries', () => ({ useProfile: () => ({ data: undefined }) }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (symbol: string) => void }) => isOpen ? <button type="button" onClick={() => onSelect(mockWidgetType === 'tradingview_chart' ? 'NASDAQ:MSFT' : 'VNM')}>Pick {mockWidgetType === 'tradingview_chart' ? 'NASDAQ:MSFT' : 'VNM'}</button> : null }));
beforeEach(() => { mockTickerOverride = null; mockWidgetConfig = {}; mockWidgetType = 'screener'; mockUpdateWidget.mockClear(); mockSetGroupSymbol.mockClear(); });
afterEach(() => jest.restoreAllMocks());

const FilterContext = createContext({ filter: '', saveFilter: (_value: string) => {} });

function FilterEditor() {
  const { filter, saveFilter } = useContext(FilterContext);
  return <input aria-label="Screener search" value={filter} onChange={event => saveFilter(event.target.value)} />;
}

function WorkspaceHarness() {
  const [filter, saveFilter] = useState('');
  return <FilterContext.Provider value={{ filter, saveFilter }}>
    <output aria-label="Saved screener filter">{filter}</output>
    <WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" showGroupLabels={false}>
      <FilterEditor />
    </WidgetWrapper>
  </FilterContext.Provider>;
}

test('maximized edits have a single live editor and survive restoring the original cell', async () => {
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  const user = userEvent.setup();
  render(<><button type="button">Background settings</button><WorkspaceHarness /></>);
  const maximizeButton = screen.getByRole('button', { name: 'Maximize widget' });
  await user.type(screen.getByRole('textbox', { name: 'Screener search' }), 'V');
  await user.click(screen.getByRole('button', { name: 'Maximize widget' }));
  const dialog = screen.getByRole('dialog', { name: 'VCI - Screener' });
  const liveEditors = screen.getAllByRole('textbox', { name: 'Screener search', hidden: true });
  expect(liveEditors).toHaveLength(1);
  expect(liveEditors[0]).toHaveValue('V');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Minimize widget' })).toHaveFocus());
  screen.getByRole('button', { name: 'Background settings' }).focus();
  expect(within(dialog).getByRole('button', { name: 'Minimize widget' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByRole('textbox', { name: 'Screener search' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: 'Minimize widget' })).toHaveFocus();
  await user.click(within(dialog).getByRole('textbox', { name: 'Screener search' }));
  await user.type(screen.getByLabelText('Screener search'), 'CB');
  expect(screen.getByLabelText('Saved screener filter')).toHaveTextContent('VCB');
  await user.click(within(dialog).getByRole('button', { name: 'Minimize widget' }));
  expect(screen.getAllByRole('textbox', { name: 'Screener search', hidden: true })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Screener search' })).toHaveValue('VCB');
  expect(maximizeButton).toHaveFocus();
});

test('a detached ticker reaches the lazy widget through Suspense when its group changes', async () => {
  const user = userEvent.setup();
  const LazyTickerWidget = React.lazy(async () => ({
    default: ({ symbol }: { symbol: string }) => <output aria-label="Widget data ticker">{symbol}</output>,
  }));
  render(
    <WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="global" symbol="VCI">
      <React.Suspense fallback={<span>Loading widget...</span>}>
        <LazyTickerWidget symbol="VCI" />
      </React.Suspense>
    </WidgetWrapper>,
  );

  expect(await screen.findByRole('status', { name: 'Widget data ticker' })).toHaveTextContent('VCI');
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Keep ticker in this widget' }));
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Group A · FPT/ }));

  expect(screen.getByRole('button', { name: /Ticker group: Group A, current ticker VCI/ })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Widget data ticker' })).toHaveTextContent('VCI');

  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Follow Group A' }));
  expect(screen.getByRole('button', { name: /Ticker group: Group A, current ticker FPT/ })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Widget data ticker' })).toHaveTextContent('FPT');
});

test('a restored detached ticker overrides the stale lazy widget prop after changing groups', async () => {
  mockTickerOverride = 'VNM';
  const user = userEvent.setup();
  const LazyTickerWidget = React.lazy(async () => ({
    default: ({ symbol }: { symbol: string }) => <output aria-label="Widget data ticker">{symbol}</output>,
  }));
  render(
    <WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="global" symbol="VCI">
      <React.Suspense fallback={<span>Loading widget...</span>}>
        <LazyTickerWidget symbol="VCI" />
      </React.Suspense>
    </WidgetWrapper>,
  );

  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker VNM/ })).toBeInTheDocument();
  expect(await screen.findByRole('status', { name: 'Widget data ticker' })).toHaveTextContent('VNM');
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Group A · FPT/ }));
  expect(screen.getByRole('button', { name: /Ticker group: Group A, current ticker VNM/ })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Widget data ticker' })).toHaveTextContent('VNM');
});

test('following a different group updates only the detached widget, not the workspace global ticker', async () => {
  mockTickerOverride = 'VNM';
  mockWidgetConfig = { tickerScope: 'override', symbol: 'VNM' };
  const onSymbolChange = jest.fn();
  const user = userEvent.setup();
  render(<>
    <WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="A" symbol="VCI" onSymbolChange={onSymbolChange}>
      <output aria-label="Local ticker" />
    </WidgetWrapper>
    <WidgetWrapper id="global-peer" title="Global peer" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="global" symbol="VCI" onSymbolChange={onSymbolChange}>
      <output aria-label="Global peer ticker" />
    </WidgetWrapper>
  </>);

  await user.click(screen.getByRole('button', { name: /Ticker group: Group A, current ticker VNM/ }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Follow Group A' }));

  expect(screen.getByRole('button', { name: /Ticker group: Group A, current ticker FPT/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker VCI/ })).toBeInTheDocument();
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test('a TradingView chart detached from global markets keeps its exchange-qualified ticker after global updates and reload', async () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'AMEX:SPY', useLinkedSymbol: true };
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  const Chart = ({ symbol }: { symbol: string }) => <output aria-label="Chart ticker">{symbol}</output>;
  const chart = (globalMarketsSymbol: string) => (
    <WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol={mockWidgetConfig.useLinkedSymbol !== false ? globalMarketsSymbol : String(mockWidgetConfig.symbol)} onSymbolChange={onSymbolChange}>
      <Chart symbol={globalMarketsSymbol} />
    </WidgetWrapper>
  );
  const view = render(chart('NASDAQ:AAPL'));
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:AAPL');

  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Keep ticker in this widget' }));
  expect(mockWidgetConfig).toEqual(expect.objectContaining({ tickerScope: 'override', symbol: 'NASDAQ:AAPL', useLinkedSymbol: false }));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NASDAQ:AAPL\. Ticker local to this widget/ })).toBeInTheDocument();

  view.rerender(chart('NYSE:IBM'));
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:AAPL');
  view.unmount();
  mockTickerOverride = null;
  render(chart('NYSE:IBM'));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NASDAQ:AAPL\. Ticker local to this widget/ })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:AAPL');
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test('a three-letter TradingView exchange never becomes the local ticker', async () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'AMEX:SPY', useLinkedSymbol: true };
  const user = userEvent.setup();
  const Chart = ({ symbol }: { symbol: string }) => <output aria-label="Chart ticker">{symbol}</output>;
  const view = render(<WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol="TVC:DXY">
    <Chart symbol="TVC:DXY" />
  </WidgetWrapper>);
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Keep ticker in this widget' }));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker TVC:DXY\. Ticker local to this widget/ })).toBeInTheDocument();
  expect(mockTickerOverride).toBe('TVC:DXY');
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('TVC:DXY');
  view.rerender(<WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol="NYSE:IBM">
    <Chart symbol="NYSE:IBM" />
  </WidgetWrapper>);
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('TVC:DXY');
  view.unmount();
  mockTickerOverride = null;
  render(<WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol="NYSE:IBM">
    <output aria-label="Chart ticker" />
  </WidgetWrapper>);
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker TVC:DXY\. Ticker local to this widget/ })).toBeInTheDocument();
});

test('external settings changes retarget a detached TradingView chart without reattaching or rewriting settings', async () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'NASDAQ:AAPL', tickerScope: 'override', useLinkedSymbol: false };
  mockTickerOverride = 'NASDAQ:AAPL';
  const user = userEvent.setup();
  const Chart = ({ symbol }: { symbol: string }) => <output aria-label="Chart ticker">{symbol}</output>;
  const chart = () => <WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol={String(mockWidgetConfig.symbol)}>
    <Chart symbol="NASDAQ:AAPL" />
  </WidgetWrapper>;
  const view = render(chart());

  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:AAPL');
  mockWidgetConfig = { ...mockWidgetConfig, symbol: 'NASDAQ:MSFT' };
  view.rerender(chart());

  await waitFor(() => expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:MSFT'));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NASDAQ:MSFT\. Ticker local to this widget/ })).toBeInTheDocument();
  expect(mockTickerOverride).toBe('NASDAQ:MSFT');
  expect(mockUpdateWidget).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Group A · FPT/ }));
  expect(screen.getByRole('status', { name: 'Chart ticker' })).toHaveTextContent('NASDAQ:MSFT');
  expect(mockWidgetConfig).toMatchObject({ symbol: 'NASDAQ:MSFT', tickerScope: 'override', useLinkedSymbol: false });
});

test('remount adopts settings saved while its detached chart was unmounted', () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'NASDAQ:AAPL', tickerScope: 'override', useLinkedSymbol: false };
  const chart = () => <WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol={String(mockWidgetConfig.symbol)}>
    <output aria-label="Chart ticker" />
  </WidgetWrapper>;
  const view = render(chart());
  mockTickerOverride = 'NASDAQ:AAPL';
  view.unmount();

  mockWidgetConfig = { ...mockWidgetConfig, symbol: 'NASDAQ:MSFT' };
  render(chart());
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NASDAQ:MSFT\. Ticker local to this widget/ })).toBeInTheDocument();
  expect(mockTickerOverride).toBe('NASDAQ:MSFT');
});

test('following the workspace after a TradingView detach restores linked markets updates', async () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'NASDAQ:AAPL', tickerScope: 'override', useLinkedSymbol: false };
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  const chart = (symbol: string) => <WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol={mockWidgetConfig.useLinkedSymbol !== false ? symbol : String(mockWidgetConfig.symbol)} onSymbolChange={onSymbolChange}>
    <output aria-label="Chart ticker" />
  </WidgetWrapper>;
  const view = render(chart('NYSE:IBM'));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NASDAQ:AAPL/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Ticker scope for this widget/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Follow Global' }));
  expect(mockWidgetConfig.useLinkedSymbol).toBe(true);
  view.rerender(chart('NYSE:IBM'));
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker NYSE:IBM/ })).toBeInTheDocument();
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test('ordinary Vietnamese group followers adopt their new group ticker without changing the global ticker', async () => {
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  render(<WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="global" symbol="VCI" onSymbolChange={onSymbolChange}>
    <output aria-label="Ticker" />
  </WidgetWrapper>);
  await user.click(screen.getByRole('button', { name: /^Ticker group: / }));
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Group A · FPT/ }));
  expect(screen.getByRole('button', { name: /Ticker group: Group A, current ticker FPT/ })).toBeInTheDocument();
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test.each(['A', 'B', 'C', 'D'] as const)('selecting a ticker in group %s does not change Global', async (group) => {
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  render(<WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup={group} symbol="VCI" showTickerSelector onSymbolChange={onSymbolChange}>
    <output />
  </WidgetWrapper>);
  await user.click(screen.getByTitle('Select widget ticker'));
  await user.click(screen.getByRole('button', { name: 'Pick VNM' }));
  expect(mockSetGroupSymbol).toHaveBeenCalledWith(group, 'VNM');
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test('selecting a Global ticker broadcasts to Global', async () => {
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  render(<WidgetWrapper id="screener" title="Screener" widgetType="screener" dashboardId="dashboard" tabId="tab" widgetGroup="global" symbol="VCI" showTickerSelector onSymbolChange={onSymbolChange}>
    <output />
  </WidgetWrapper>);
  await user.click(screen.getByTitle('Select widget ticker'));
  await user.click(screen.getByRole('button', { name: 'Pick VNM' }));
  expect(mockSetGroupSymbol).toHaveBeenCalledWith('global', 'VNM');
  expect(onSymbolChange).toHaveBeenCalledWith('VNM');
});

test('changing a detached TradingView chart ticker remains local', async () => {
  mockWidgetType = 'tradingview_chart';
  mockWidgetConfig = { symbol: 'NASDAQ:AAPL', tickerScope: 'override', useLinkedSymbol: false };
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  render(<WidgetWrapper id="screener" title="TradingView Chart" widgetType="tradingview_chart" dashboardId="dashboard" tabId="tab" symbol="NASDAQ:AAPL" showTickerSelector onSymbolChange={onSymbolChange}>
    <output aria-label="Chart ticker" />
  </WidgetWrapper>);
  await user.click(screen.getByTitle('Select widget ticker'));
  await user.click(screen.getByRole('button', { name: 'Pick NASDAQ:MSFT' }));
  expect(mockWidgetConfig).toEqual(expect.objectContaining({ tickerScope: 'override', symbol: 'NASDAQ:MSFT', useLinkedSymbol: false }));
  expect(onSymbolChange).not.toHaveBeenCalled();
});

test('changing a detached native widget ticker updates its local content without broadcasting to peers', async () => {
  mockWidgetConfig = { symbol: 'FPT', tickerScope: 'override', timeframe: '1Y' };
  mockTickerOverride = 'FPT';
  const user = userEvent.setup();
  const onSymbolChange = jest.fn();
  function NativeContent({ symbol }: { symbol?: string }) {
    return <output aria-label="Native content ticker">{symbol}</output>;
  }
  render(<>
    <WidgetWrapper id="screener" title="Native widget" widgetType="screener" dashboardId="dashboard" tabId="tab" symbol="VCI" showTickerSelector onSymbolChange={onSymbolChange}>
      <NativeContent />
    </WidgetWrapper>
    <WidgetWrapper id="global-peer" title="Global peer" widgetType="screener" dashboardId="dashboard" tabId="tab" symbol="VCI">
      <output aria-label="Peer ticker" />
    </WidgetWrapper>
  </>);
  expect(screen.getByRole('status', { name: 'Native content ticker' })).toHaveTextContent('FPT');
  await user.click(screen.getByTitle('Select widget ticker'));
  await user.click(screen.getByRole('button', { name: 'Pick VNM' }));
  expect(screen.getByRole('status', { name: 'Native content ticker' })).toHaveTextContent('VNM');
  expect(mockWidgetConfig).toEqual({ symbol: 'VNM', tickerScope: 'override', timeframe: '1Y' });
  expect(mockTickerOverride).toBe('VNM');
  expect(mockSetGroupSymbol).not.toHaveBeenCalled();
  expect(onSymbolChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Ticker group: Global, current ticker VCI/ })).toBeInTheDocument();
});

test('an unsaved widget draft stays in its one live editor across maximize and restore', async () => {
  const user = userEvent.setup();
  function DraftEditor() {
    const [draft, setDraft] = useState('');
    return <textarea aria-label="Unsaved note" value={draft} onChange={event => setDraft(event.target.value)} />;
  }
  render(<WidgetWrapper id="screener" title="Notes" widgetType="notes" dashboardId="dashboard" tabId="tab">
    <DraftEditor />
  </WidgetWrapper>);
  await user.type(screen.getByRole('textbox', { name: 'Unsaved note' }), 'first draft');
  await user.click(screen.getByRole('button', { name: 'Maximize widget' }));
  const dialog = screen.getByRole('dialog', { name: 'VCI - Notes' });
  expect(within(dialog).getByRole('textbox', { name: 'Unsaved note' })).toHaveValue('first draft');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Unsaved note' }), { target: { value: 'first draft extended' } });
  await user.click(within(dialog).getByRole('button', { name: 'Minimize widget' }));
  expect(screen.getAllByRole('textbox', { name: 'Unsaved note', hidden: true })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toHaveValue('first draft extended');
});

test('actual Notes widget keeps unsaved thesis and legacy notes when maximized and restored', async () => {
  mockWidgetType = 'notes';
  const user = userEvent.setup();
  render(<WidgetWrapper id="screener" title="Notes" widgetType="notes" dashboardId="dashboard" tabId="tab" symbol="VCI">
    <NotesWidget id="screener" symbol="VCI" config={mockWidgetConfig} />
  </WidgetWrapper>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Thesis' }), { target: { value: 'Unsaved growth case' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Legacy notes' }), { target: { value: 'Unsaved research' } });
  await user.click(screen.getByRole('button', { name: 'Maximize widget' }));
  const dialog = screen.getByRole('dialog', { name: 'VCI - Notes' });
  expect(within(dialog).getByRole('textbox', { name: 'Thesis' })).toHaveValue('Unsaved growth case');
  expect(within(dialog).getByRole('textbox', { name: 'Legacy notes' })).toHaveValue('Unsaved research');
  await user.click(within(dialog).getByRole('button', { name: 'Minimize widget' }));
  expect(screen.getByRole('textbox', { name: 'Thesis' })).toHaveValue('Unsaved growth case');
  expect(screen.getByRole('textbox', { name: 'Legacy notes' })).toHaveValue('Unsaved research');
  expect(mockUpdateWidget).not.toHaveBeenCalled();
});

test('the widget menu opens scoped requirements and limitations and closes again', async () => {
  mockWidgetType = 'financial_ratios';
  const user = userEvent.setup();
  render(<WidgetWrapper id="screener" title="Financial Ratios" widgetType="financial_ratios" dashboardId="dashboard" tabId="tab" symbol="VCI">
    <output aria-label="Hidden widget content" />
  </WidgetWrapper>);

  expect(screen.queryByRole('region', { name: 'Widget requirements and limitations' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Widget actions for Financial Ratios' }));
  await user.click(await screen.findByRole('menuitem', { name: /Requirements & limitations/ }));

  const panel = screen.getByRole('region', { name: 'Widget requirements and limitations' });
  expect(panel).toHaveTextContent('financial_ratios');
  expect(panel).toHaveTextContent('Current ticker: VCI');
  expect(panel).toHaveTextContent('Available ratios do not establish completeness of statements');

  await user.click(within(panel).getByRole('button', { name: 'Close widget requirements' }));
  expect(screen.queryByRole('region', { name: 'Widget requirements and limitations' })).not.toBeInTheDocument();
});

test('wrapper badges use source age while preserving retrieval and cache lineage', async () => {
  const fetchedAt = '2026-10-08T03:00:00Z';
  const now = jest.spyOn(Date, 'now').mockReturnValue(new Date(fetchedAt).getTime());
  const payload = buildWidgetRuntime({
    empty: false, apiGroup: '/news', endpoint: '/news/market', sourceLabel: 'Stored published articles',
    lastDataDate: '2026-09-21', fetchedAt, cached: true,
  });
  try {
    const user = userEvent.setup();
    render(<WidgetWrapper id="screener" title="News" widgetType="screener" dashboardId="dashboard" tabId="tab" data={payload}>
      <output />
    </WidgetWrapper>);

    expect(screen.queryByRole('button', { name: 'Data status: Live' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Data status: Stale' }));
    expect(screen.getByText('Source as of')).toBeInTheDocument();
    expect(screen.getByText('2026-09-21', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Fetched at')).toBeInTheDocument();
    expect(screen.getByText(formatAbsoluteTimestamp(fetchedAt), { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Cached snapshot')).toBeInTheDocument();
  } finally {
    now.mockRestore();
  }
});

test('header parameters follow the control the widget is actually rendering', async () => {
  const user = userEvent.setup();
  const onConfigChange = jest.fn();

  // Stand-in for PriceChartWidget: the inner control owns the live value and
  // reports it through the runtime payload, while `config` stays whatever the
  // saved layout last stored. #209 is exactly that divergence in a protected
  // workspace, where onConfigChange is never wired.
  function ChartStandIn({ onDataChange }: { onDataChange?: (data: unknown) => void }) {
    const [mode, setMode] = React.useState('candles');
    React.useEffect(() => {
      onDataChange?.(buildWidgetRuntime({
        empty: false, apiGroup: '/chart', endpoint: '/chart', extra: { chartType: mode },
      }));
    }, [mode, onDataChange]);
    return <button type="button" onClick={() => setMode('area')}>3M Area</button>;
  }

  render(<WidgetWrapper
    id="price"
    title="Price Chart"
    widgetType="price_chart"
    dashboardId="dashboard"
    tabId="tab"
    parameters={[{ id: 'chartType', label: 'Type', currentValue: 'candles',
      options: [{ value: 'candles', label: 'Candles' }, { value: 'area', label: 'Area' }],
      onChange: onConfigChange }]}
  >
    <ChartStandIn />
  </WidgetWrapper>);

  expect(screen.getByRole('button', { name: /Type: Candles/ })).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: '3M Area' }, { timeout: 4000 }));
  expect(screen.getByRole('button', { name: /Type: Area/ })).toBeInTheDocument();
});

function AgentDataPublisher({ payload, onDataChange }: {
  readonly payload: unknown;
  readonly onDataChange?: (data: unknown) => void;
}) {
  React.useEffect(() => { onDataChange?.(payload); }, [payload, onDataChange]);
  return <output aria-label="Reported widget data" />;
}

async function captureWidgetExport(user: ReturnType<typeof userEvent.setup>, title: string, format: 'CSV' | 'JSON') {
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const downloads: Blob[] = [];
  URL.createObjectURL = source => {
    if (source instanceof Blob) downloads.push(source);
    return 'blob:widget-export';
  };
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await user.click(screen.getByRole('button', { name: `Widget actions for ${title}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: `Export as ${format}` }));

    const [download] = downloads;
    expect(click).toHaveBeenCalledTimes(downloads.length);
    if (!download) return null;
    expect(downloads).toHaveLength(1);
    expect(download.type).toBe(format === 'CSV' ? 'text/csv' : 'application/json');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(download);
    });
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click.mockRestore();
  }
}

async function downloadWidgetCSV(user: ReturnType<typeof userEvent.setup>, title: string) {
  const text = await captureWidgetExport(user, title, 'CSV');
  if (text === null) throw new Error('Expected one widget CSV');
  const lines = text.trimEnd().split('\n');
  // Split at the first comma; these metadata assertions use scalar CSV cells.
  const metadata = new Map(lines.filter(line => line.startsWith('# ')).map(line => {
    const separator = line.indexOf(',');
    return [line.slice(2, separator), line.slice(separator + 1)];
  }));
  return { metadata, rows: lines.filter(line => !line.startsWith('# ')) };
}

test.each([
  { name: 'withheld without a projection', empty: true, projection: {}, expected: null, csv: null, sample: null },
  { name: 'explicit null', empty: false, projection: { exportData: null }, expected: null, csv: null, sample: null },
  { name: 'explicit empty rows', empty: true, projection: { exportData: [] }, expected: [], csv: null, sample: null },
  { name: 'observed zero', empty: false, projection: { exportData: 0 }, expected: 0, csv: ['value', '0'], sample: 0 },
  {
    name: 'projected coverage summary', empty: true, projection: { exportData: { observation: null } },
    expected: { observation: null }, csv: ['observation'], sample: null,
  },
])('JSON and CSV respect $name instead of raw fallback rows', async ({ empty, projection, expected, csv, sample }) => {
  const user = userEvent.setup();
  const onCopilotClick = jest.fn();
  render(<WidgetWrapper id="screener" title="Cash Flow" widgetType="cash_flow" dashboardId="dashboard" tabId="tab"
    data={[{ propFallback: 123 }]} onCopilotClick={onCopilotClick}>
    <AgentDataPublisher payload={{
      __widgetRuntime: { layoutHint: { empty }, provenance: { period: 'FY' }, ...projection },
      data: [{ runtimeFallback: 999 }],
    }} />
  </WidgetWrapper>);

  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(onCopilotClick).toHaveBeenCalledWith(expect.objectContaining({ dataSample: sample }));
  const json = await captureWidgetExport(user, 'Cash Flow', 'JSON');
  expect(JSON.parse(json ?? '{}')).toEqual({ _provenance: expect.objectContaining({ period: 'FY' }), data: expected });
  if (csv === null) expect(await captureWidgetExport(user, 'Cash Flow', 'CSV')).toBeNull();
  else expect((await downloadWidgetCSV(user, 'Cash Flow')).rows).toEqual(csv);
});

test('the wrapped Heatmap retains partial coverage on a cache hit in its toolbar and CSV', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T05:30:00Z'));
  mockWidgetType = 'market_heatmap';
  const user = userEvent.setup();
  const payload = buildWidgetRuntime({
    empty: false, apiGroup: '/market', endpoint: '/market/heatmap', sourceLabel: 'Market heatmap',
    lastDataDate: '2026-11-13', fetchedAt: '2026-11-13T05:00:00Z', coverage: 'partial', cached: true,
    extra: { groupBy: 'sector', groupCount: 1 },
  });
  render(<WidgetWrapper id="screener" title="Market Heatmap" widgetType="market_heatmap" dashboardId="dashboard" tabId="tab">
    <AgentDataPublisher payload={payload} />
  </WidgetWrapper>);

  const { metadata, rows } = await downloadWidgetCSV(user, 'Market Heatmap');

  expect(screen.getByRole('button', { name: 'Data status: Partial coverage' })).toBeInTheDocument();
  expect(metadata.get('data_status')).toBe('Partial coverage');
  expect(metadata.get('coverage')).toBe('partial');
  expect(metadata.get('cached')).toBe('true');
  expect(rows).toEqual(['groupBy,groupCount', 'sector,1']);
});

test('Open VniAgent sends a bounded admitted sample with its source qualifications', async () => {
  mockWidgetType = 'cash_flow';
  const onCopilotClick = jest.fn();
  const user = userEvent.setup();
  const partialRow = {
    period: '2025', operating_cash_flow: 0, investing_cash_flow: -42,
    depreciation: null, unit_metadata: { depreciation: { unavailable_reason: 'Source unit not verified' } },
  };
  const rows = [partialRow, ...['2024', '2023', '2022', '2021', '2020'].map(period => ({ period, operating_cash_flow: 12 }))];
  const qualifications = {
    sourceLabel: 'Cash flow', updatedAt: '2025-12-31', fetchedAt: '2026-02-13T03:42:00.000Z',
    period: 'FY', periodScope: 'shared', units: 'VND', basis: 'Consolidated / annual',
    warnings: ['2025 depreciation withheld: source unit not verified.'],
    observationStatus: 'available', refreshStatus: 'failed', cached: true,
  };

  render(<WidgetWrapper id="screener" title="Cash Flow" widgetType="cash_flow" dashboardId="dashboard" tabId="tab" onCopilotClick={onCopilotClick}>
    <AgentDataPublisher payload={{
      __widgetRuntime: {
        layoutHint: { empty: false },
        provenance: { ...qualifications, capturedAt: '2026-10-01T00:00:00Z', providerError: 'provider-debug-fixture' },
        exportData: rows,
      },
      data: [{ period: '2025', depreciation: 999, raw: 'provider-debug-fixture' }],
    }} />
  </WidgetWrapper>);

  await screen.findByLabelText('Reported widget data');
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));

  expect(onCopilotClick).toHaveBeenCalledTimes(1);
  expect(onCopilotClick).toHaveBeenCalledWith(expect.objectContaining({
    widgetTypeKey: 'cash_flow', symbol: 'VCI', dataProvenance: qualifications, dataSample: rows.slice(0, 5),
  }));
  expect(JSON.stringify(onCopilotClick.mock.calls)).not.toMatch(/__widgetRuntime|provider-debug-fixture/);
});

test('Open VniAgent keeps the verified Foreign Trading coverage window and drops private detail', async () => {
  mockWidgetType = 'foreign_trading';
  const user = userEvent.setup();
  const onCopilotClick = jest.fn();
  const sourceLabel = `Foreign Trading ${'x'.repeat(500)}`;
  const observation = { date: '2026-11-13', buy_value: 0, sell_value: null };
  const coverageDetail = {
    requestedStart: '2026-08-19', requestedEnd: '2026-11-13', requestedSessions: 60,
    observedStart: '2026-11-13', observedEnd: '2026-11-13', observedSessions: 1,
    lastValidatedSession: '2026-11-13', gapSessions: 59, calendarVerified: true,
  };
  render(<WidgetWrapper id="screener" title="Foreign Trading" widgetType="foreign_trading"
    dashboardId="dashboard" tabId="tab" onCopilotClick={onCopilotClick}>
    <AgentDataPublisher payload={{ __widgetRuntime: {
      layoutHint: { empty: false }, exportData: [observation],
      provenance: {
        sourceLabel, updatedAt: '2026-11-13', coverage: 'partial',
        coverageDetail: { ...coverageDetail, privateDetail: 'provider-debug-fixture', providerIds: ['internal'] },
        endpoint: 'internal', warnings: ['provider-debug-fixture'],
      },
    } }} />
  </WidgetWrapper>);

  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));

  expect(onCopilotClick).toHaveBeenCalledWith(expect.objectContaining({
    dataSample: [observation],
    dataProvenance: { sourceLabel: sourceLabel.slice(0, 500), updatedAt: '2026-11-13', coverage: 'partial', coverageDetail },
  }));
});

test.each([
  { publication: 'explicitly empty admitted rows', exportData: [] },
  { publication: 'withheld rows with a legacy fallback present', exportData: undefined },
])('Open VniAgent keeps qualifications without a sample for $publication', async ({ exportData }) => {
  mockWidgetType = 'cash_flow';
  const onCopilotClick = jest.fn();
  const user = userEvent.setup();
  const qualifications = {
    sourceLabel: 'Cash flow', updatedAt: null, fetchedAt: '2026-02-13T03:42:00.000Z',
    period: 'FY', periodScope: 'local', observationStatus: 'unavailable',
    warnings: ['2025 returned no certified value.'],
  };

  render(<WidgetWrapper id="screener" title="Cash Flow" widgetType="cash_flow" dashboardId="dashboard" tabId="tab"
    data={[{ symbol: 'FPT', period: '2025', operating_cash_flow: 123 }]} onCopilotClick={onCopilotClick}>
    <AgentDataPublisher payload={{
      __widgetRuntime: { layoutHint: { empty: true }, provenance: qualifications, exportData },
      data: [{ period: '2025', operating_cash_flow: 999, raw: 'provider-debug-fixture' }],
    }} />
  </WidgetWrapper>);

  await screen.findByLabelText('Reported widget data');
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));

  expect(onCopilotClick).toHaveBeenCalledWith(expect.objectContaining({
    symbol: 'VCI', dataSample: null, dataProvenance: qualifications,
  }));
  expect(JSON.stringify(onCopilotClick.mock.calls)).not.toMatch(/__widgetRuntime|provider-debug-fixture|FPT/);
});

test('Open VniAgent keeps a legacy sample without forwarding raw provider warning text', async () => {
  mockWidgetType = 'market_heatmap';
  const onCopilotClick = jest.fn();
  const user = userEvent.setup();
  render(<WidgetWrapper id="screener" title="Market Heatmap" widgetType="market_heatmap" dashboardId="dashboard" tabId="tab" onCopilotClick={onCopilotClick}>
    <AgentDataPublisher payload={buildWidgetRuntime({
      empty: false, apiGroup: '/market', endpoint: '/market/heatmap', sourceLabel: 'Market heatmap',
      lastDataDate: '2026-11-13', cached: true, warnings: ['provider-debug-fixture'],
      extra: { groupCount: 2 },
    })} />
  </WidgetWrapper>);

  await screen.findByLabelText('Reported widget data');
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));

  expect(onCopilotClick).toHaveBeenCalledWith(expect.objectContaining({
    dataSample: { groupCount: 2 },
    dataProvenance: { sourceLabel: 'Market heatmap', updatedAt: '2026-11-13', cached: true },
  }));
  expect(JSON.stringify(onCopilotClick.mock.calls)).not.toMatch(/__widgetRuntime|provider-debug-fixture/);
});

test('ATR status, exports, and VniAgent use only the selected symbol’s admission', async () => {
  mockWidgetType = 'atr_regime';
  const user = userEvent.setup();
  const onCopilotClick = jest.fn();
  const reason = 'Unresolved interior sessions prevent consecutive true ranges.';
  const summary = { atr: null, rank: null, suggestedShares: null };
  const publication = buildWidgetRuntime({
    empty: true, apiGroup: '/equity', endpoint: '/equity/historical',
    observationStatus: 'unavailable', admissionReason: reason,
    requestScope: { symbol: 'VCI' }, exportData: summary,
    warnings: ['provider-debug-fixture'],
  });
  const wrapper = () => (
    <WidgetWrapper id="screener" title="ATR Regime" widgetType="atr_regime" dashboardId="dashboard" tabId="tab"
      data={{ atr: 999 }} onCopilotClick={onCopilotClick}>
      <AgentDataPublisher payload={publication} />
    </WidgetWrapper>
  );
  const { rerender } = render(wrapper());
  await user.click(screen.getByRole('button', { name: 'Data status: Unavailable' }));
  expect(screen.getByText(reason)).toBeInTheDocument();
  await user.keyboard('{Escape}');

  const json = await captureWidgetExport(user, 'ATR Regime', 'JSON');
  expect(JSON.parse(json ?? '{}')).toEqual({
    _provenance: expect.objectContaining({ admissionReason: reason, symbol: 'VCI' }), data: summary,
  });
  expect((await downloadWidgetCSV(user, 'ATR Regime')).metadata.get('admission_reason')).toBe(reason);
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(onCopilotClick).toHaveBeenLastCalledWith(expect.objectContaining({
    symbol: 'VCI', dataSample: null,
    dataProvenance: { updatedAt: null, observationStatus: 'unavailable', admissionReason: reason },
  }));

  mockTickerOverride = 'FPT';
  rerender(wrapper());
  expect(screen.queryByRole('button', { name: 'Data status: Unavailable' })).not.toBeInTheDocument();
  expect(await captureWidgetExport(user, 'ATR Regime', 'CSV')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(onCopilotClick).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'FPT', dataSample: null }));
  expect(onCopilotClick.mock.lastCall?.[0]).not.toHaveProperty('dataProvenance');
});
