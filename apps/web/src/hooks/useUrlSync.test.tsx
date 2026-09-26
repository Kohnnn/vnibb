import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { __resolveDashboardSlug as resolveDashboardSlug, useUrlSync } from '@/hooks/useUrlSync';

type UrlSyncHarnessProps = {
  ready: boolean;
  activeDashboardId: string | null;
  activeTabId: string | null;
  symbol: string;
  dashboardIds: string[];
  tabIdsByDashboard: Record<string, string[]>;
  applyDashboard: (id: string) => void;
  applyTab: (id: string) => void;
  applySymbol: (symbol: string) => void;
};

function UrlSyncHarness(props: UrlSyncHarnessProps) {
  useUrlSync({
    ready: props.ready,
    activeDashboardId: props.activeDashboardId,
    activeTabId: props.activeTabId,
    symbol: props.symbol,
    dashboardIds: props.dashboardIds,
    getTabIds: (dashboardId) => props.tabIdsByDashboard[dashboardId] ?? [],
    applyDashboard: props.applyDashboard,
    applyTab: props.applyTab,
    applySymbol: props.applySymbol,
  });

  return null;
}

describe('useUrlSync deep-link restore', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/dashboard?dashboard=custom-dashboard&tab=custom-tab&symbol=vci');
  });

  it('applies requested dashboard and tab after dashboards load behind the initial ready render', () => {
    // Given: the URL names a dashboard and tab before persisted dashboards are available.
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    const initialProps: UrlSyncHarnessProps = {
      ready: true,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'HPG',
      dashboardIds: [],
      tabIdsByDashboard: {},
      applyDashboard,
      applyTab,
      applySymbol,
    };

    // When: valid dashboard and tab ids become available on the next render.
    const { rerender } = render(<UrlSyncHarness {...initialProps} />);
    rerender(
      <UrlSyncHarness
        {...initialProps}
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );

    // Then: the original URL still drives the requested dashboard, tab, and symbol.
    expect(applyDashboard).toHaveBeenCalledWith('custom-dashboard');
    expect(applyTab).toHaveBeenCalledWith('custom-tab');
    expect(applySymbol).not.toHaveBeenCalled();
    rerender(
      <UrlSyncHarness
        {...initialProps}
        activeDashboardId="custom-dashboard"
        activeTabId="custom-tab"
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );
    expect(applySymbol).toHaveBeenCalledWith('VCI');
  });
});

function ScopedUrlHarness() {
  const [dashboard, setDashboard] = useState('original');
  const [symbols, setSymbols] = useState({ original: 'VCB', imported: 'VCI' });
  const symbol = symbols[dashboard as keyof typeof symbols];
  useUrlSync({
    ready: true,
    activeDashboardId: dashboard,
    activeTabId: `${dashboard}-tab`,
    symbol,
    dashboardIds: ['original', 'imported'],
    getTabIds: id => [`${id}-tab`],
    applyDashboard: setDashboard,
    applyTab: () => {},
    applySymbol: next => setSymbols(previous => ({ ...previous, [dashboard]: next })),
  });
  return <>
    <output aria-label="Original ticker">{symbols.original}</output>
    <output aria-label="Imported ticker">{symbols.imported}</output>
    <output aria-label="Active workspace">{dashboard}</output>
    <button onClick={() => setDashboard('original')}>Return to original</button>
  </>;
}

test('deep links apply the ticker only after entering its workspace and preserve the departing ticker', () => {
  window.history.replaceState(null, '', '/dashboard?dashboard=imported&symbol=FPT');
  render(<ScopedUrlHarness />);
  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('VCB');
  expect(screen.getByLabelText('Imported ticker')).toHaveTextContent('FPT');
  expect(screen.getByLabelText('Active workspace')).toHaveTextContent('imported');
  expect(new URLSearchParams(window.location.search).get('symbol')).toBe('FPT');
  fireEvent.click(screen.getByRole('button', { name: 'Return to original' }));
  expect(new URLSearchParams(window.location.search).get('symbol')).toBe('VCB');

  act(() => {
    window.history.replaceState(null, '', '/dashboard?dashboard=imported&symbol=HPG');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('VCB');
  expect(screen.getByLabelText('Imported ticker')).toHaveTextContent('HPG');
  act(() => {
    window.history.replaceState(null, '', '/dashboard?dashboard=original&symbol=ACB');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('ACB');
  expect(screen.getByLabelText('Imported ticker')).toHaveTextContent('HPG');
  expect(new URLSearchParams(window.location.search).get('symbol')).toBe('ACB');
  act(() => {
    window.history.replaceState(null, '', '/dashboard?dashboard=imported&symbol=FPT');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.history.replaceState(null, '', '/dashboard?dashboard=imported&symbol=MSN');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('ACB');
  expect(screen.getByLabelText('Imported ticker')).toHaveTextContent('MSN');
  expect(new URLSearchParams(window.location.search).get('symbol')).toBe('MSN');
});

describe('resolveDashboardSlug', () => {
  const valid = [
    'default-fundamental',
    'default-technical',
    'default-quant',
    'default-global-markets',
  ];

  it('returns the slug unchanged when it is already a valid id', () => {
    expect(resolveDashboardSlug('default-quant', valid)).toBe('default-quant');
  });

  it('maps the legacy default-global slug to default-global-markets', () => {
    expect(resolveDashboardSlug('default-global', valid)).toBe('default-global-markets');
  });

  it('maps short aliases to their canonical ids', () => {
    expect(resolveDashboardSlug('global', valid)).toBe('default-global-markets');
    expect(resolveDashboardSlug('global-markets', valid)).toBe('default-global-markets');
    expect(resolveDashboardSlug('fundamental', valid)).toBe('default-fundamental');
    expect(resolveDashboardSlug('technical', valid)).toBe('default-technical');
    expect(resolveDashboardSlug('quant', valid)).toBe('default-quant');
  });

  it('returns null for unknown slugs', () => {
    expect(resolveDashboardSlug('does-not-exist', valid)).toBeNull();
  });

  it('returns null when the alias target is not in the valid set', () => {
    expect(resolveDashboardSlug('global', ['default-fundamental'])).toBeNull();
  });
});
