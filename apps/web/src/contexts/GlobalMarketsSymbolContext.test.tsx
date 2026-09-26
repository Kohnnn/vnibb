import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { GlobalMarketsSymbolProvider, useGlobalMarketsSymbol } from './GlobalMarketsSymbolContext';
import { GLOBAL_MARKETS_SYMBOL_STORAGE_KEY } from '@/lib/globalMarketsSymbol';
import type { Dashboard } from '@/types/dashboard';

interface DashboardScope {
  state: { dashboards: Dashboard[]; activeDashboardId: string };
  activeDashboard: Dashboard;
  updateDashboardRuntime: (id: string, updates: Partial<Dashboard>) => void;
}

jest.mock('@/contexts/DashboardContext', () => {
  const actualReact = jest.requireActual<typeof React>('react');
  const context = actualReact.createContext<DashboardScope | null>(null);
  return {
    TestDashboardProvider: context.Provider,
    useDashboard: () => actualReact.useContext(context),
  };
});

const { TestDashboardProvider } = jest.requireMock('@/contexts/DashboardContext') as {
  TestDashboardProvider: React.Provider<DashboardScope | null>;
};

const template: Dashboard = {
  id: 'default-global-markets', name: 'Global markets', order: 0, isDefault: true,
  globalMarketsSymbol: 'AMEX:SPY', showGroupLabels: false, tabs: [], syncGroups: [],
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

function LinkedChart() {
  const { globalMarketsSymbol, appGlobalMarketsSymbol, setGlobalMarketsSymbol, setGlobalMarketsSymbolForDashboard } = useGlobalMarketsSymbol();
  return <>
    <output aria-label="Chart ticker">{globalMarketsSymbol}</output>
    <output aria-label="Profile ticker">{appGlobalMarketsSymbol}</output>
    <button onClick={() => setGlobalMarketsSymbol(' NASDAQ:MSFT ')}>Change chart ticker</button>
    <button onClick={() => setGlobalMarketsSymbolForDashboard('NASDAQ:NVDA', template)}>Change system destination ticker</button>
  </>;
}
function DestinationTicker({ dashboard }: { dashboard: Dashboard }) {
  const { setGlobalMarketsSymbolForDashboard } = useGlobalMarketsSymbol();
  return <>
    <output aria-label="Destination ticker">{dashboard.globalMarketsSymbol}</output>
    <button onClick={() => setGlobalMarketsSymbolForDashboard('NASDAQ:NVDA', dashboard)}>Change destination ticker</button>
  </>;
}

function WorkspaceHarness({ startOnImport = false }: { startOnImport?: boolean }) {
  const [activeId, setActiveId] = useState(startOnImport ? 'import-restored' : 'default-global-markets');
  const [dashboards, setDashboards] = useState<Dashboard[]>([
    template,
    { ...template, id: 'personal-original', globalMarketsSymbol: undefined, isDefault: false },
    { ...template, id: 'import-restored', globalMarketsSymbol: 'NASDAQ:AAPL', isDefault: false },
    { ...template, id: 'personal-scoped', globalMarketsSymbol: 'NYSE:IBM', isDefault: false },
  ]);
  const context: DashboardScope = {
    state: { dashboards, activeDashboardId: activeId },
    activeDashboard: dashboards.find((dashboard) => dashboard.id === activeId)!,
    updateDashboardRuntime: (id, updates) => setDashboards((current) => current.map((dashboard) => dashboard.id === id ? { ...dashboard, ...updates } : dashboard)),
  };
  return <>
    <button onClick={() => setActiveId('default-global-markets')}>System workspace</button>
    <button onClick={() => setActiveId('personal-original')}>Original workspace</button>
    <button onClick={() => setActiveId('import-restored')}>Restored workspace</button>
    <button onClick={() => setActiveId('personal-scoped')}>Existing scoped workspace</button>
    <TestDashboardProvider value={context}><GlobalMarketsSymbolProvider><DestinationTicker dashboard={dashboards.find((dashboard) => dashboard.id === 'personal-scoped')!} /><LinkedChart /></GlobalMarketsSymbolProvider></TestDashboardProvider>
  </>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY, 'AMEX:SPY');
});

test('restored linked chart uses exported AAPL and edits only the imported dashboard, not the SPY profile or original', () => {
  render(<WorkspaceHarness startOnImport />);
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Change chart ticker' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:MSFT');
  expect(screen.getByLabelText('Profile ticker')).toHaveTextContent('AMEX:SPY');
  expect(window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY)).toBe('AMEX:SPY');
  fireEvent.click(screen.getByRole('button', { name: 'Original workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('AMEX:SPY');
  fireEvent.click(screen.getByRole('button', { name: 'System workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('AMEX:SPY');
  fireEvent.click(screen.getByRole('button', { name: 'Restored workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:MSFT');
});

test('switching dashboards never overwrites an existing scoped ticker; ordinary personal workspaces retain global behavior', () => {
  render(<WorkspaceHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Restored workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Original workspace' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change chart ticker' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:MSFT');
  expect(window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY)).toBe('NASDAQ:MSFT');
  fireEvent.click(screen.getByRole('button', { name: 'Restored workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'System workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:MSFT');
});

test('pre-existing personal dashboard with explicit snapshot keeps its own symbol independent of imports', () => {
  render(<WorkspaceHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Existing scoped workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NYSE:IBM');
  fireEvent.click(screen.getByRole('button', { name: 'Change chart ticker' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restored workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Existing scoped workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:MSFT');
  expect(window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY)).toBe('AMEX:SPY');
});

test('a TradingView destination ticker changes its scoped workspace, not the active imported source', () => {
  render(<WorkspaceHarness startOnImport />);
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Change destination ticker' }));
  expect(screen.getByLabelText('Destination ticker')).toHaveTextContent('NASDAQ:NVDA');
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  expect(screen.getByLabelText('Profile ticker')).toHaveTextContent('AMEX:SPY');
  fireEvent.click(screen.getByRole('button', { name: 'Existing scoped workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:NVDA');
});

test('system destination selection updates the shared profile without touching the imported ticker', () => {
  render(<WorkspaceHarness startOnImport />);
  fireEvent.click(screen.getByRole('button', { name: 'Change system destination ticker' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:AAPL');
  expect(screen.getByLabelText('Profile ticker')).toHaveTextContent('NASDAQ:NVDA');
  fireEvent.click(screen.getByRole('button', { name: 'System workspace' }));
  expect(screen.getByLabelText('Chart ticker')).toHaveTextContent('NASDAQ:NVDA');
});
