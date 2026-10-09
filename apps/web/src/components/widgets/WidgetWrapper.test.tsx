import React, { createContext, useContext, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetWrapper } from './WidgetWrapper';
import { NotesWidget } from './NotesWidget';
import { DEFAULT_GROUPS } from '@/types/widget';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
let mockTickerOverride: string | null = null;
let mockWidgetConfig: Record<string, unknown> = {};
let mockWidgetType = 'screener';
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
    setGroupSymbol: jest.fn(),
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
jest.mock('./TickerCombobox', () => ({ TickerCombobox: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (symbol: string) => void }) => isOpen ? <button type="button" onClick={() => onSelect('NASDAQ:MSFT')}>Pick NASDAQ:MSFT</button> : null }));
beforeEach(() => { mockTickerOverride = null; mockWidgetConfig = {}; mockWidgetType = 'screener'; mockUpdateWidget.mockClear(); });

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
  const user = userEvent.setup();
  render(<WorkspaceHarness />);
  await user.type(screen.getByRole('textbox', { name: 'Screener search' }), 'V');
  await user.click(screen.getByRole('button', { name: 'Maximize widget' }));
  const dialog = screen.getByRole('dialog', { name: 'VCI - Screener' });
  const liveEditors = screen.getAllByRole('textbox', { name: 'Screener search', hidden: true });
  expect(liveEditors).toHaveLength(1);
  expect(liveEditors[0]).toHaveValue('V');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Minimize widget' })).toHaveFocus());
  await user.click(within(dialog).getByRole('textbox', { name: 'Screener search' }));
  await user.type(screen.getByLabelText('Screener search'), 'CB');
  expect(screen.getByLabelText('Saved screener filter')).toHaveTextContent('VCB');
  await user.click(within(dialog).getByRole('button', { name: 'Minimize widget' }));
  expect(screen.getAllByRole('textbox', { name: 'Screener search', hidden: true })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Screener search' })).toHaveValue('VCB');
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
  const now = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-08T03:00:00Z').getTime());
  const payload = buildWidgetRuntime({
    empty: false, apiGroup: '/news', endpoint: '/news/market', sourceLabel: 'Stored published articles',
    lastDataDate: '2026-09-21T15:00:00Z', fetchedAt: '2026-10-08T03:00:00Z', cached: true,
  });
  try {
    const user = userEvent.setup();
    render(<WidgetWrapper id="screener" title="News" widgetType="screener" dashboardId="dashboard" tabId="tab" data={payload}>
      <output />
    </WidgetWrapper>);

    expect(screen.queryByRole('button', { name: 'Data status: Live' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Data status: Stale' }));
    expect(screen.getByText('Source as of')).toBeInTheDocument();
    expect(screen.getByText('Fetched at')).toBeInTheDocument();
    expect(screen.getByText('Cached snapshot')).toBeInTheDocument();
  } finally {
    now.mockRestore();
  }
});
