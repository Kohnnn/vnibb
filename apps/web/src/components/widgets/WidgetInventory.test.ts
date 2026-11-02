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

// Registry-only IDs are resolvable but absent from the library catalog. Each is
// dispositioned explicitly so adding or dropping one is a deliberate change.
// `library-hidden`: section override exists but the catalog does not list it.
// `tradingview-catalog`: TradingView embeds surfaced through other entry points.
const REGISTRY_ONLY_DISPOSITIONS: Record<string, 'library-hidden' | 'tradingview-catalog'> = {
  market_heatmap: 'library-hidden',
  portfolio_tracker: 'library-hidden',
  dividend_ladder: 'library-hidden',
  ai_copilot: 'library-hidden',
  rs_ranking: 'library-hidden',
  positioning_dashboard: 'library-hidden',
  tradingview_chart: 'tradingview-catalog',
  tradingview_symbol_overview: 'tradingview-catalog',
  tradingview_mini_chart: 'tradingview-catalog',
  tradingview_market_summary: 'tradingview-catalog',
  tradingview_market_overview: 'tradingview-catalog',
  tradingview_stock_market: 'tradingview-catalog',
  tradingview_market_data: 'tradingview-catalog',
  tradingview_ticker_tape: 'tradingview-catalog',
  tradingview_ticker_tag: 'tradingview-catalog',
  tradingview_single_ticker: 'tradingview-catalog',
  tradingview_ticker: 'tradingview-catalog',
  tradingview_stock_heatmap: 'tradingview-catalog',
  tradingview_crypto_heatmap: 'tradingview-catalog',
  tradingview_forex_cross_rates: 'tradingview-catalog',
  tradingview_etf_heatmap: 'tradingview-catalog',
  tradingview_forex_heatmap: 'tradingview-catalog',
  tradingview_screener: 'tradingview-catalog',
  tradingview_crypto_market: 'tradingview-catalog',
  tradingview_symbol_info: 'tradingview-catalog',
  tradingview_technical_analysis: 'tradingview-catalog',
  tradingview_fundamental_data: 'tradingview-catalog',
  tradingview_company_profile: 'tradingview-catalog',
  tradingview_top_stories: 'tradingview-catalog',
  tradingview_economic_calendar: 'tradingview-catalog',
  tradingview_economic_map: 'tradingview-catalog',
};

describe('widget inventory dispositions', () => {
  test('every registry-only ID has a recorded disposition', () => {
    const catalog = new Set(widgetDefinitions.map((widget) => widget.type as string));
    const registryOnly = getRegisteredWidgetIds().filter((type) => !catalog.has(type)).sort();
    // A registry-only ID without a disposition is an unreviewed surface.
    expect(registryOnly.filter((type) => !(type in REGISTRY_ONLY_DISPOSITIONS))).toEqual([]);
  });

  test('no disposition names an unregistered widget', () => {
    const registered = new Set(getRegisteredWidgetIds());
    expect(Object.keys(REGISTRY_ONLY_DISPOSITIONS).filter((type) => !registered.has(type))).toEqual([]);
  });

  test('every recorded disposition is a known kind', () => {
    const kinds = new Set(Object.values(REGISTRY_ONLY_DISPOSITIONS));
    expect([...kinds].sort()).toEqual(['library-hidden', 'tradingview-catalog']);
  });
});
