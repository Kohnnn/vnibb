import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SymbolLinkProvider, useSymbolLink } from './SymbolLinkContext';
import { WidgetGroupProvider } from './WidgetGroupContext';
import { DEFAULT_GROUPS, type WidgetGroupConfig, type WidgetGroupId } from '@/types/widget';
import { GLOBAL_SYMBOL_STORAGE_KEY } from '@/lib/defaultTicker';

type Groups = Record<WidgetGroupId, WidgetGroupConfig>;
interface DashboardScope {
  activeDashboard: { id: string; widgetGroups?: Groups };
  updateDashboardRuntime: (id: string, updates: { widgetGroups?: Groups }) => void;
}

jest.mock('@/contexts/DashboardContext', () => {
  const actualReact = jest.requireActual<typeof React>('react');
  const DashboardScopeContext = actualReact.createContext<DashboardScope | null>(null);
  return {
    TestDashboardProvider: DashboardScopeContext.Provider,
    useDashboard: () => actualReact.useContext(DashboardScopeContext),
  };
});

const { TestDashboardProvider } = jest.requireMock('@/contexts/DashboardContext') as {
  TestDashboardProvider: React.Provider<DashboardScope | null>;
};

function LinkedTicker() {
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  return <>
    <output aria-label="Linked ticker">{globalSymbol}</output>
    <button onClick={() => setGlobalSymbol(' hpg ')}>Change linked ticker</button>
  </>;
}

function WorkspaceHarness({ startScoped = false }: { startScoped?: boolean }) {
  const [scoped, setScoped] = useState(startScoped);
  const [groups, setGroups] = useState<Groups>({ ...DEFAULT_GROUPS, global: { ...DEFAULT_GROUPS.global, symbol: 'FPT' } });
  const [mounted, setMounted] = useState(true);
  const dashboardScope: DashboardScope = {
    activeDashboard: scoped ? { id: 'imported', widgetGroups: groups } : { id: 'original' },
    updateDashboardRuntime: (_id, updates) => { if (updates.widgetGroups) setGroups(updates.widgetGroups); },
  };
  return <>
    <button onClick={() => setScoped(value => !value)}>Switch workspace</button>
    <button onClick={() => setMounted(value => !value)}>Toggle providers</button>
    <TestDashboardProvider value={dashboardScope}>
      {mounted && <WidgetGroupProvider><SymbolLinkProvider><LinkedTicker /></SymbolLinkProvider></WidgetGroupProvider>}
    </TestDashboardProvider>
  </>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(GLOBAL_SYMBOL_STORAGE_KEY, 'VCB');
});

test('scoped linked edits survive provider remount without overwriting the original ticker', () => {
  render(<WorkspaceHarness />);
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('VCB');
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('FPT');
  fireEvent.click(screen.getByRole('button', { name: 'Change linked ticker' }));
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('HPG');
  expect(window.localStorage.getItem(GLOBAL_SYMBOL_STORAGE_KEY)).toBe('VCB');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle providers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle providers' }));
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('HPG');
  expect(window.localStorage.getItem(GLOBAL_SYMBOL_STORAGE_KEY)).toBe('VCB');
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('VCB');
});

test('mounting directly in a restored workspace leaves the stored original ticker intact', () => {
  render(<WorkspaceHarness startScoped />);
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('FPT');
  expect(window.localStorage.getItem(GLOBAL_SYMBOL_STORAGE_KEY)).toBe('VCB');
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change linked ticker' }));
  expect(screen.getByLabelText('Linked ticker')).toHaveTextContent('HPG');
  expect(window.localStorage.getItem(GLOBAL_SYMBOL_STORAGE_KEY)).toBe('HPG');
});
