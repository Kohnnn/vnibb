import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { __resolveDashboardSlug as resolveDashboardSlug, useUrlSync } from '@/hooks/useUrlSync';

type UrlSyncHarnessProps = {
  ready: boolean;
  dashboardCatalogueReady?: boolean;
  activeDashboardId: string | null;
  activeTabId: string | null;
  symbol: string;
  dashboardIds: string[];
  tabIdsByDashboard: Record<string, string[]>;
  tabNamesByDashboard?: Record<string, Record<string, string>>;
  userNavigationSeq?: number;
  applyDashboard: (id: string, options?: { programmatic?: boolean }) => void;
  applyTab: (id: string, options?: { programmatic?: boolean }) => void;
  applySymbol: (symbol: string) => void;
};

function UrlSyncHarness(props: UrlSyncHarnessProps) {
  useUrlSync({
    ready: props.ready,
    dashboardCatalogueReady: props.dashboardCatalogueReady ?? false,
    activeDashboardId: props.activeDashboardId,
    activeTabId: props.activeTabId,
    symbol: props.symbol,
    dashboardIds: props.dashboardIds,
    resolveTabId: (dashboardId, slug) => {
      const ids = props.tabIdsByDashboard[dashboardId] ?? [];
      if (ids.includes(slug)) return slug;
      const names = props.tabNamesByDashboard?.[dashboardId] ?? {};
      const entry = Object.entries(names).find(([, name]) => name === slug);
      return entry ? entry[0] : null;
    },
    userNavigationSeq: props.userNavigationSeq ?? 0,
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

  it('defers the deep link until the requested workspace hydrates, then applies it (fresh profile)', () => {
    // Fresh profile: the URL is the only source of truth and nothing is loaded yet.
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    const initialProps: UrlSyncHarnessProps = {
      ready: true,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'VNM',
      dashboardIds: [],
      tabIdsByDashboard: {},
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...initialProps} />);
    // Not loaded yet: the request is held, not dropped.
    expect(applyDashboard).not.toHaveBeenCalled();

    // Bundled/held layouts hydrate, then the requested workspace appears.
    rerender(
      <UrlSyncHarness
        {...initialProps}
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );

    expect(applyDashboard).toHaveBeenCalledWith('custom-dashboard', { programmatic: true });
    expect(applyTab).toHaveBeenCalledWith('custom-tab', { programmatic: true });
  });

  it('canonicalizes an unknown dashboard only after the catalogue finishes hydrating', () => {
    window.history.replaceState(null, '', '/dashboard?dashboard=missing-dashboard&tab=missing-tab&symbol=HPG&view=compact#workspace');
    const props: UrlSyncHarnessProps = {
      ready: true,
      dashboardCatalogueReady: false,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'HPG',
      dashboardIds: ['default-dashboard'],
      tabIdsByDashboard: { 'default-dashboard': ['default-tab', 'settled-tab'] },
      applyDashboard: jest.fn(),
      applyTab: jest.fn(),
      applySymbol: jest.fn(),
    };

    const { rerender } = render(<UrlSyncHarness {...props} />);
    expect(new URLSearchParams(window.location.search).get('dashboard')).toBe('missing-dashboard');

    rerender(<UrlSyncHarness {...props} activeTabId="settled-tab" />);
    expect(new URLSearchParams(window.location.search).get('dashboard')).toBe('missing-dashboard');

    rerender(<UrlSyncHarness {...props} activeTabId="settled-tab" dashboardCatalogueReady />);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/dashboard?dashboard=default-dashboard&tab=settled-tab&symbol=HPG&view=compact#workspace',
    );
    expect(props.applyDashboard).not.toHaveBeenCalled();
    expect(props.applyTab).not.toHaveBeenCalled();
  });

  it('canonicalizes an unknown dashboard when the catalogue is already hydrated', () => {
    window.history.replaceState(null, '', '/dashboard?dashboard=missing-dashboard&tab=missing-tab&symbol=HPG');
    render(
      <UrlSyncHarness
        ready
        dashboardCatalogueReady
        activeDashboardId="default-dashboard"
        activeTabId="default-tab"
        symbol="HPG"
        dashboardIds={['default-dashboard']}
        tabIdsByDashboard={{ 'default-dashboard': ['default-tab'] }}
        applyDashboard={jest.fn()}
        applyTab={jest.fn()}
        applySymbol={jest.fn()}
      />,
    );

    expect(window.location.search).toBe('?dashboard=default-dashboard&tab=default-tab&symbol=HPG');
  });

  it('restores a published workspace arriving with the terminal catalogue signal', () => {
    const props: UrlSyncHarnessProps = {
      ready: true,
      dashboardCatalogueReady: false,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'HPG',
      dashboardIds: ['default-dashboard'],
      tabIdsByDashboard: { 'default-dashboard': ['default-tab'] },
      applyDashboard: jest.fn(),
      applyTab: jest.fn(),
      applySymbol: jest.fn(),
    };
    const { rerender } = render(<UrlSyncHarness {...props} />);
    expect(props.applyDashboard).not.toHaveBeenCalled();

    rerender(
      <UrlSyncHarness
        {...props}
        dashboardCatalogueReady
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );

    expect(props.applyDashboard).toHaveBeenCalledWith('custom-dashboard', { programmatic: true });
    expect(props.applyTab).toHaveBeenCalledWith('custom-tab', { programmatic: true });
    expect(new URLSearchParams(window.location.search).get('dashboard')).toBe('custom-dashboard');
  });

  it('waits for a published tab to register even when its dashboard already exists', () => {
    // Fresh profile: `default-fundamental` is a bundled dashboard, but its
    // published `news-events` tab has not loaded yet. The dashboard being
    // present must not let the restore apply before the tab exists.
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    window.history.pushState(
      null,
      '',
      '/dashboard?dashboard=default-fundamental&tab=news-events&symbol=VNM',
    );
    const initialProps: UrlSyncHarnessProps = {
      ready: true,
      activeDashboardId: 'default-fundamental',
      activeTabId: 'overview',
      symbol: 'VNM',
      dashboardIds: ['default-fundamental'],
      tabIdsByDashboard: { 'default-fundamental': ['overview'] },
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...initialProps} />);
    // Dashboard exists but the tab does not: nothing applied yet.
    expect(applyTab).not.toHaveBeenCalled();

    // The published template lands and registers the tab.
    rerender(
      <UrlSyncHarness
        {...initialProps}
        tabIdsByDashboard={{ 'default-fundamental': ['overview', 'news-events'] }}
      />,
    );

    expect(applyTab).toHaveBeenCalledWith('news-events', { programmatic: true });
  });

  it('abandons a deferred deep link when the user navigates before it resolves', () => {
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
      userNavigationSeq: 0,
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...initialProps} />);

    // The user picks another workspace before the requested one hydrates. The
    // context signals that with a bumped navigation sequence — not a state diff,
    // which cannot tell hydration churn from a real click.
    rerender(
      <UrlSyncHarness
        {...initialProps}
        activeTabId="a-user-chosen-tab"
        userNavigationSeq={1}
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );

    expect(applyDashboard).not.toHaveBeenCalled();
    expect(applyTab).not.toHaveBeenCalled();
  });

  it('does not treat hydration churn as user navigation', () => {
    // The bundled seed moves the active workspace on its own while the deep link
    // is still pending. The sequence is unchanged, so the held request must
    // survive and apply once the requested workspace finally registers.
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    const initialProps: UrlSyncHarnessProps = {
      ready: true,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'VNM',
      dashboardIds: [],
      tabIdsByDashboard: {},
      userNavigationSeq: 0,
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...initialProps} />);
    // Seed settles onto an unrelated tab — not a user action, seq stays 0.
    rerender(
      <UrlSyncHarness {...initialProps} activeTabId="some-other-tab" />,
    );
    expect(applyDashboard).not.toHaveBeenCalled();

    // The requested workspace finally hydrates; the held request still applies.
    rerender(
      <UrlSyncHarness
        {...initialProps}
        activeTabId="some-other-tab"
        dashboardIds={['default-dashboard', 'custom-dashboard']}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );
    expect(applyDashboard).toHaveBeenCalledWith('custom-dashboard', { programmatic: true });
    expect(applyTab).toHaveBeenCalledWith('custom-tab', { programmatic: true });
  });

  it('restores dashboard, tab and symbol when dashboards are already hydrated', () => {
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    const props: UrlSyncHarnessProps = {
      ready: true,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'HPG',
      dashboardIds: ['default-dashboard', 'custom-dashboard'],
      tabIdsByDashboard: { 'custom-dashboard': ['custom-tab'] },
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...props} />);

    expect(applyDashboard).toHaveBeenCalledWith('custom-dashboard', { programmatic: true });
    expect(applyTab).toHaveBeenCalledWith('custom-tab', { programmatic: true });

    rerender(
      <UrlSyncHarness
        {...props}
        activeDashboardId="custom-dashboard"
        activeTabId="custom-tab"
      />,
    );
    expect(applySymbol).toHaveBeenCalledWith('VCI');
  });


  it('drops a deferred tab slug when Back/Forward lands on another workspace first', () => {
    // The deep link names a published tab that has not registered yet, so the
    // slug is deferred. The user then goes Back to a different workspace before
    // the tab arrives. Applying the deferral afterwards would set a tab id that
    // belongs to the workspace they left onto the current one.
    const applyDashboard = jest.fn();
    const applyTab = jest.fn();
    const applySymbol = jest.fn();
    window.history.pushState(
      null,
      '',
      '/dashboard?dashboard=custom-dashboard&tab=custom-tab&symbol=vci',
    );
    const initialProps: UrlSyncHarnessProps = {
      ready:true,
      activeDashboardId: 'default-dashboard',
      activeTabId: 'default-tab',
      symbol: 'VNM',
      dashboardIds: ['default-dashboard', 'custom-dashboard'],
      tabIdsByDashboard: { 'custom-dashboard':[] },
      applyDashboard,
      applyTab,
      applySymbol,
    };

    const { rerender } = render(<UrlSyncHarness {...initialProps} />);
    expect(applyDashboard).toHaveBeenCalledWith('custom-dashboard', { programmatic:true });
    expect(applyTab).not.toHaveBeenCalled();

    act(() => {
      window.history.replaceState(null, '', '/dashboard?dashboard=default-dashboard&tab=default-tab');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // The published layout finally registers `custom-tab`. The history move
    // already abandoned it, so the live workspace keeps its own tab.
    rerender(
      <UrlSyncHarness
        {...initialProps}
        tabIdsByDashboard={{ 'custom-dashboard': ['custom-tab'] }}
      />,
    );
    expect(applyTab).not.toHaveBeenCalledWith('custom-tab', { programmatic:true });
  });
});


function ScopedUrlHarness({ dashboardCatalogueReady = true }: { dashboardCatalogueReady?: boolean }) {
  const [dashboard, setDashboard] = useState('original');
  const [symbols, setSymbols] = useState({ original: 'VCB', imported: 'VCI' });
  const symbol = symbols[dashboard as keyof typeof symbols];
  useUrlSync({
    ready: true,
    dashboardCatalogueReady,
    activeDashboardId: dashboard,
    activeTabId: `${dashboard}-tab`,
    symbol,
    dashboardIds: ['original', 'imported'],
    resolveTabId: (id, slug) => (slug === `${id}-tab` ? slug : null),
    userNavigationSeq: 0,
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

test('unknown dashboard recovery preserves the valid inbound symbol after catalogue completion', () => {
  window.history.replaceState(null, '', '/dashboard?dashboard=missing-dashboard&tab=removed-tab&symbol=FPT');
  const view = render(<ScopedUrlHarness dashboardCatalogueReady={false} />);
  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('VCB');
  expect(new URLSearchParams(window.location.search).get('dashboard')).toBe('missing-dashboard');

  view.rerender(<ScopedUrlHarness dashboardCatalogueReady />);

  expect(screen.getByLabelText('Original ticker')).toHaveTextContent('FPT');
  expect(screen.getByLabelText('Imported ticker')).toHaveTextContent('VCI');
  expect(screen.getByLabelText('Active workspace')).toHaveTextContent('original');
  expect(window.location.search).toBe('?dashboard=original&tab=original-tab&symbol=FPT');
});

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

test('pointer tab navigation creates entries that restore the workspace, tab and scoped symbol on Back/Forward', async () => {
  const discovery = 'published-discovery-tab';
  const fundamentals = 'published-fundamentals-tab';
  const importedTab = 'published-imported-tab';
  const routerState = { __NA: true, tree: ['dashboard'], unrelated: { retained: true } };
  window.history.replaceState(routerState, '', `/dashboard?dashboard=original&tab=${discovery}&view=compact#workspace`);
  const initialHistoryLength = window.history.length;

  function PointerNavigationHarness() {
    const [view, setView] = useState({
      dashboard: 'original',
      tabs: { original: discovery, imported: importedTab },
      symbols: { original: 'VCB', imported: 'VCI' },
      userNavigationSeq: 0,
    });
    const { dashboard, tabs, symbols, userNavigationSeq } = view;
    const key = dashboard as keyof typeof tabs;
    useUrlSync({
      ready: true,
      dashboardCatalogueReady: true,
      activeDashboardId: dashboard,
      activeTabId: tabs[key],
      symbol: symbols[key],
      dashboardIds: ['original', 'imported'],
      resolveTabId: (id, slug) => (id === 'original' ? [discovery, fundamentals] : [importedTab]).includes(slug) ? slug : null,
      userNavigationSeq,
      applyDashboard: dashboard => setView(previous => ({ ...previous, dashboard })),
      applyTab: id => setView(previous => ({ ...previous, tabs: { ...previous.tabs, [previous.dashboard]: id } })),
      applySymbol: symbol => setView(previous => ({ ...previous, symbols: { ...previous.symbols, [dashboard]: symbol } })),
    });
    return <>
      <output aria-label="Active view">{`${dashboard}/${tabs[key]}/${symbols[key]}`}</output>
      <button onClick={() => {
        setView(previous => ({ ...previous, tabs: { ...previous.tabs, original: fundamentals }, userNavigationSeq: previous.userNavigationSeq + 1 }));
      }}>Fundamentals</button>
      <button onClick={() => {
        setView(previous => ({ ...previous, dashboard: 'imported', userNavigationSeq: previous.userNavigationSeq + 1 }));
      }}>Imported workspace</button>
    </>;
  }

  render(<PointerNavigationHarness />);
  expect(window.history.length).toBe(initialHistoryLength);
  expect(window.location.search).toContain('symbol=VCB');

  fireEvent.pointerDown(screen.getByRole('button', { name: 'Fundamentals' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fundamentals' }));
  expect(screen.getByLabelText('Active view')).toHaveTextContent(`original/${fundamentals}/VCB`);
  expect(window.history.length).toBe(initialHistoryLength + 1);

  fireEvent.click(screen.getByRole('button', { name: 'Imported workspace' }));
  expect(screen.getByLabelText('Active view')).toHaveTextContent(`imported/${importedTab}/VCI`);
  expect(window.history.length).toBe(initialHistoryLength + 2);
  expect(window.history.state).toEqual(expect.objectContaining(routerState));

  for (const [direction, expected] of [
    ['back', `original/${fundamentals}/VCB`],
    ['back', `original/${discovery}/VCB`],
    ['forward', `original/${fundamentals}/VCB`],
    ['forward', `imported/${importedTab}/VCI`],
  ] as const) {
    await act(async () => {
      await new Promise<void>(resolve => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        window.history[direction]();
      });
    });
    await waitFor(() => expect(screen.getByLabelText('Active view')).toHaveTextContent(expected));
    const [dashboard, tab, symbol] = expected.split('/');
    const params = new URLSearchParams(window.location.search);
    expect([params.get('dashboard'), params.get('tab'), params.get('symbol')]).toEqual([dashboard, tab, symbol]);
    expect(params.get('view')).toBe('compact');
    expect(window.location.hash).toBe('#workspace');
    expect(window.history.length).toBe(initialHistoryLength + 2);
    expect(window.history.state).toEqual(expect.objectContaining(routerState));
  }
});

test.each(['tab', 'workspace'] as const)('Back repairs a removed inactive %s to the current view without appending history', async kind => {
  const dashboardId = (id: string) => kind === 'workspace' ? `personal-${id}` : 'personal';
  const viewUrl = (id: string) => `/dashboard?dashboard=${dashboardId(id)}&tab=tab-${id}&symbol=FPT&view=compact#workspace`;
  window.history.replaceState({ __NA: true, retained: true }, '', viewUrl('A'));

  function RemovedTargetHarness() {
    const [active, setActive] = useState('A');
    const [removed, setRemoved] = useState(false);
    const [userNavigationSeq, setUserNavigationSeq] = useState(0);
    const available = removed ? ['A', 'C'] : ['A', 'B', 'C'];
    useUrlSync({
      ready: true,
      dashboardCatalogueReady: true,
      activeDashboardId: dashboardId(active),
      activeTabId: `tab-${active}`,
      symbol: 'FPT',
      dashboardIds: available.map(dashboardId),
      resolveTabId: (dashboard, slug) => available.some(id => dashboardId(id) === dashboard && slug === `tab-${id}`) ? slug : null,
      userNavigationSeq,
      applyDashboard: id => { if (kind === 'workspace') setActive(id.replace('personal-', '')); },
      applyTab: id => setActive(id.replace('tab-', '')),
      applySymbol: () => {},
    });
    return <>
      <output aria-label="Current view">{`${dashboardId(active)}/tab-${active}/FPT`}</output>
      {['B', 'C'].map(id => <button key={id} onClick={() => {
        setActive(id);
        setUserNavigationSeq(previous => previous + 1);
      }}>Select {id}</button>)}
      <button onClick={() => setRemoved(true)}>Remove inactive B</button>
    </>;
  }

  render(<RemovedTargetHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Select B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select C' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove inactive B' }));
  const historyLength = window.history.length;

  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history.back();
    });
  });

  expect(screen.getByLabelText('Current view')).toHaveTextContent(`${dashboardId('C')}/tab-C/FPT`);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(viewUrl('C'));
  expect(window.history.length).toBe(historyLength);
  expect(window.history.state).toEqual(expect.objectContaining({ __NA: true, retained: true }));
});

test.each(['workspace-alias', 'removed-tab'] as const)('Back canonicalizes a different workspace with a %s after its view lands', async kind => {
  const targetDashboard = 'default-fundamental';
  const targetTab = 'published-fundamentals';
  const targetUrl = `/dashboard?dashboard=${kind === 'workspace-alias' ? 'fundamental' : targetDashboard}&tab=${kind === 'removed-tab' ? 'removed-tab' : targetTab}&symbol=FPT&view=compact#workspace`;
  window.history.replaceState({ __NA: true, retained: true }, '', targetUrl);
  window.history.pushState(window.history.state, '', '/dashboard?dashboard=personal-C&tab=tab-C&symbol=FPT&view=compact#workspace');
  const historyLength = window.history.length;

  function AppliedTargetHarness() {
    const [view, setView] = useState({ dashboard: 'personal-C', tab: 'tab-C' });
    useUrlSync({
      ready: true,
      dashboardCatalogueReady: true,
      activeDashboardId: view.dashboard,
      activeTabId: view.tab,
      symbol: 'FPT',
      dashboardIds: ['personal-C', targetDashboard],
      resolveTabId: (dashboard, slug) => slug === (dashboard === targetDashboard ? targetTab : 'tab-C') ? slug : null,
      userNavigationSeq: 0,
      applyDashboard: dashboard => setView({ dashboard, tab: targetTab }),
      applyTab: tab => setView(previous => ({ ...previous, tab })),
      applySymbol: () => {},
    });
    return <output aria-label="Applied view">{`${view.dashboard}/${view.tab}/FPT`}</output>;
  }

  render(<AppliedTargetHarness />);
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history.back();
    });
  });

  expect(screen.getByLabelText('Applied view')).toHaveTextContent(`${targetDashboard}/${targetTab}/FPT`);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    `/dashboard?dashboard=${targetDashboard}&tab=${targetTab}&symbol=FPT&view=compact#workspace`,
  );
  expect(window.history.length).toBe(historyLength);
  expect(window.history.state).toEqual(expect.objectContaining({ __NA: true, retained: true }));
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
