import {
  WIDGET_LAYOUT_BEHAVIORS,
  getWidgetDefaultLayout,
  getWidgetSizeContract,
  autoFitGridItems,
  type CompactableLayoutItem,
} from '@/lib/dashboardLayout';
import { widgetDefinitions } from '@/data/widgetDefinitions';
import { tradingViewWidgetDefaultLayouts } from '@/lib/tradingViewWidgets';
import type { WidgetType } from '@/types/dashboard';

/**
 * Drift guard for the single-source-of-truth layout contract.
 *
 * `WIDGET_LAYOUT_BEHAVIORS` in `@/lib/dashboardLayout` is the operative size contract.
 * `widgetDefinitions[].defaultLayout` is derived from it at module load. These tests
 * make the "three sources of truth" drift risk a CI failure instead of a silent bug.
 */
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
