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
  tabNamesByDashboard?: Record<string, Record<string, string>>;
  userNavigationSeq?: number;
  applyDashboard: (id: string, options?: { programmatic?: boolean }) => void;
  applyTab: (id: string, options?: { programmatic?: boolean }) => void;
  applySymbol: (symbol: string) => void;
};

function UrlSyncHarness(props: UrlSyncHarnessProps) {
  useUrlSync({
    ready: props.ready,
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
