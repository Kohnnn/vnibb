import {
  WIDGET_LAYOUT_BEHAVIORS,
  getWidgetDefaultLayout,
  getWidgetSizeContract,
  autoFitGridItems,
  hasLayoutCoordinatesChanged,
  type CompactableLayoutItem,
} from '@/lib/dashboardLayout';
import { widgetDefinitions } from '@/data/widgetDefinitions';
import { tradingViewWidgetDefaultLayouts } from '@/lib/tradingViewWidgets';
import type { Dashboard, WidgetType } from '@/types/dashboard';
import {
  createGlobalMarketsDashboard,
  shouldRefreshGlobalMarketsLayout,
} from '@/contexts/DashboardContext';

/**
 * Drift guard for the single-source-of-truth layout contract.
 *
 * `WIDGET_LAYOUT_BEHAVIORS` in `@/lib/dashboardLayout` is the operative size contract.
 * `widgetDefinitions[].defaultLayout` is derived from it at module load. These tests
 * make the "three sources of truth" drift risk a CI failure instead of a silent bug.
 */
const getDashboardWidgetTypes = (dashboard: Dashboard): WidgetType[] =>
  dashboard.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.type));

describe('default dashboard layouts', () => {
  it('includes Polymarket in the Global Markets system dashboard', () => {
    // Given: the static Global Markets system dashboard template.
    const dashboard = createGlobalMarketsDashboard();

    // When: its default widgets are flattened across tabs.
    const widgetTypes = getDashboardWidgetTypes(dashboard);

    // Then: Polymarket is present on first-load/global default layout.
    expect(widgetTypes).toContain('polymarket');
  });

  it('does not force a refresh for the up-to-date default Global Markets dashboard', () => {
    // Given: the current default template (already contains Polymarket + world-news widgets).
    const dashboard = createGlobalMarketsDashboard();

    // Then: no needless re-layout churn for users already on the latest template.
    expect(shouldRefreshGlobalMarketsLayout(dashboard)).toBe(false);
  });

  it('forces a refresh for an existing persisted dashboard that is missing Polymarket', () => {
    // Given: a persisted Global Markets dashboard from before Polymarket existed -
    // it has the world-news widgets and no legacy symbols, so it otherwise looks current.
    const upToDate = createGlobalMarketsDashboard();
    const legacy: Dashboard = {
      ...upToDate,
      tabs: upToDate.tabs.map((tab) => ({
        ...tab,
        widgets: tab.widgets.filter((widget) => widget.type !== 'polymarket'),
      })),
    };

    // Sanity: the legacy fixture really has no polymarket widget.
    expect(getDashboardWidgetTypes(legacy)).not.toContain('polymarket');

    // Then: the gate detects the missing widget and triggers a re-layout so
    // existing users actually receive the Polymarket widget (not just fresh installs).
    expect(shouldRefreshGlobalMarketsLayout(legacy)).toBe(true);
  });
});

describe('widget layout contract', () => {
  const definitionTypes = widgetDefinitions.map((d) => d.type);
  const tvTypes = Object.keys(tradingViewWidgetDefaultLayouts) as WidgetType[];
  const allTypes = Array.from(new Set<WidgetType>([...definitionTypes, ...tvTypes]));

  it('covers every widget type that can be inserted', () => {
    const missing = allTypes.filter((t) => !(t in WIDGET_LAYOUT_BEHAVIORS));
    expect(missing).toEqual([]);
  });

  it('never resolves to the broken 3x3 fallback for known types', () => {
    const collapsed = allTypes.filter((t) => {
      const layout = getWidgetDefaultLayout(t);
      return layout.w <= 3 && layout.h <= 3;
    });
    // index_comparison / tradingview_ticker_tag etc. are legitimately small but not 3x3.
    expect(collapsed).toEqual([]);
  });

  it('keeps widgetDefinitions.defaultLayout in sync with the contract', () => {
    const mismatches: string[] = [];
    for (const def of widgetDefinitions) {
      const { x: _x, y: _y, ...expected } = getWidgetDefaultLayout(def.type);
      // Compare the fields that definitions carry.
      if (
        def.defaultLayout.w !== expected.w ||
        def.defaultLayout.h !== expected.h ||
        def.defaultLayout.minW !== expected.minW ||
        def.defaultLayout.minH !== expected.minH
      ) {
        mismatches.push(
          `${def.type}: def=${JSON.stringify(def.defaultLayout)} contract=${JSON.stringify(expected)}`
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('produces a valid size contract for every type (min <= default)', () => {
    const invalid: string[] = [];
    for (const t of allTypes) {
      const c = getWidgetSizeContract(t);
      if (c.minW > c.defaultW || c.minH > c.defaultH) {
        invalid.push(`${t}: ${JSON.stringify(c)}`);
      }
    }
    expect(invalid).toEqual([]);
  });
});

/**
 * Responsive derivation guarantees. DashboardGrid derives md/sm/xs from the
 * persisted lg layout via `autoFitGridItems(items, cols)`. These lock in the
 * properties that derivation relies on: width clamping to the target column
 * count and identity preservation.
 */
describe('autoFitGridItems responsive derivation', () => {
  const baseItems: Array<CompactableLayoutItem & { i: string }> = [
    { i: 'a', type: 'price_chart', layout: { x: 0, y: 0, w: 16, h: 10 } },
    { i: 'b', type: 'watchlist', layout: { x: 16, y: 0, w: 4, h: 5 } },
    { i: 'c', type: 'news_feed', layout: { x: 0, y: 10, w: 10, h: 7 } },
  ];

  for (const cols of [12, 6, 2]) {
    it(`clamps every item width to <= ${cols} columns`, () => {
      const out = autoFitGridItems(baseItems, cols);
      for (const item of out) {
        expect(item.layout.w).toBeLessThanOrEqual(cols);
        expect(item.layout.x + item.layout.w).toBeLessThanOrEqual(cols);
      }
    });
  }

  it('preserves item identity and count across derivation', () => {
    const out = autoFitGridItems(baseItems, 6) as Array<CompactableLayoutItem & { i?: string }>;
    expect(out).toHaveLength(baseItems.length);
    expect(out.map((i) => i.i).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps coordinates finite and non-negative', () => {
    const out = autoFitGridItems(baseItems, 2);
    for (const item of out) {
      expect(Number.isFinite(item.layout.x)).toBe(true);
      expect(Number.isFinite(item.layout.y)).toBe(true);
      expect(item.layout.x).toBeGreaterThanOrEqual(0);
      expect(item.layout.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hasLayoutCoordinatesChanged', () => {
  const stored = { x: 0, y: 2, w: 8, h: 7 };

  it('returns false when React Grid Layout echoes unchanged widget coordinates', () => {
    expect(hasLayoutCoordinatesChanged(stored, { x: 0, y: 2, w: 8, h: 7 })).toBe(false);
  });

  it.each([
    ['x', { x: 1, y: 2, w: 8, h: 7 }],
    ['y', { x: 0, y: 3, w: 8, h: 7 }],
    ['w', { x: 0, y: 2, w: 9, h: 7 }],
    ['h', { x: 0, y: 2, w: 8, h: 8 }],
  ])('returns true when %s changes', (_field, next) => {
    expect(hasLayoutCoordinatesChanged(stored, next)).toBe(true);
  });
});
