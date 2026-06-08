import {
  WIDGET_LAYOUT_BEHAVIORS,
  getWidgetDefaultLayout,
  getWidgetSizeContract,
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
