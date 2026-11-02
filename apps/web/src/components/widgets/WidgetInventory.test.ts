// Inventory invariant for the brand widget batches (#200).
//
// The library may only offer IDs the registry can resolve, and every ID a saved
// layout or built-in template can reference must resolve too. This pins the
// union instead of the individual components.
import { widgetDefinitions } from '@/data/widgetDefinitions';
import { MAIN_TAB_TEMPLATES, TAB_WIDGET_TEMPLATES } from '@/contexts/DashboardContext/templates';
import { getRegisteredWidgetIds } from './WidgetRegistry';

const registered = new Set(getRegisteredWidgetIds());

describe('widget inventory', () => {
  test('every catalog ID resolves in the registry', () => {
    const unresolved = widgetDefinitions.map((widget) => widget.type).filter((type) => !registered.has(type));
    expect(unresolved).toEqual([]);
  });

  test('every built-in template widget ID resolves in the registry', () => {
    const templateTypes = [
      ...MAIN_TAB_TEMPLATES.flatMap((template) => template.widgets.map((widget) => widget.type as string)),
      ...Object.values(TAB_WIDGET_TEMPLATES).flatMap((template) =>
        template.map((widget) => widget.type as string),
      ),
    ];
    const unresolved = Array.from(new Set(templateTypes)).filter((type) => !registered.has(type));
    expect(unresolved).toEqual([]);
  });
});

// Registered IDs the library catalog deliberately does not offer. The catalog is
// the real `widgetDefinitions` list (it spreads the TradingView entries in), so
// an ID listed here that the catalog does contain is a stale disposition.
const REGISTRY_ONLY: Record<string, string> = {
  market_heatmap: 'superseded by market_overview heatmap mode',
  dividend_ladder: 'superseded by dividend history in the fundamentals tab',
  ai_copilot: 'opened from the shell, not inserted as a tile',
  rs_ranking: 'superseded by the quant ranking widget',
  positioning_dashboard: 'superseded by the quant positioning widget',
};

describe('widget inventory dispositions', () => {
  const catalog = new Set(widgetDefinitions.map((widget) => widget.type as string));

  test('every registered ID is either catalogued or explicitly dispositioned', () => {
    const undispositioned = getRegisteredWidgetIds().filter(
      (type) => !catalog.has(type) && !(type in REGISTRY_ONLY),
    );
    expect(undispositioned).toEqual([]);
  });

  test('no disposition outlives its registry-only status', () => {
    expect(Object.keys(REGISTRY_ONLY).filter((type) => catalog.has(type))).toEqual([]);
    expect(Object.values(REGISTRY_ONLY).every((reason) => reason.length > 0)).toBe(true);
  });
});
