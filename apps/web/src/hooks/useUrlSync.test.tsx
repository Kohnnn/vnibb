import { render } from '@testing-library/react';

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
    expect(applySymbol).toHaveBeenCalledWith('VCI');
  });
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
