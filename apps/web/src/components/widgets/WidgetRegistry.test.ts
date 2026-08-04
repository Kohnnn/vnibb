/**
 * Regression guard for the "Polymarket widget not found" bug.
 *
 * Before this test existed, the registry would silently miss large chunks of
 * catalogue IDs (Polymarket, derivatives, ownership, comparison, etc.) and the
 * "widget not found" message would only surface as a console.warn AFTER the
 * product shipped. This file pins the contract: every `type` declared in
 * widgetDefinitions.ts must have a corresponding entry in WidgetRegistry.
 */

import { isWidgetPlaceholder, widgetRegistry } from './WidgetRegistry';
import { normalizeWidgetType, widgetDefinitions } from '@/data/widgetDefinitions';
import { createGlobalMarketsDashboard, createMainSystemDashboard } from '@/contexts/DashboardContext/systemDashboards';

describe('WidgetRegistry completeness', () => {
    const declaredTypes = widgetDefinitions.map((entry: { type: string }) => entry.type);
    const registeredTypes = Array.from(widgetRegistry.keys()) as string[];

    it('exposes every widget ID declared in widgetDefinitions.ts', () => {
        const missing = declaredTypes.filter((type: string) => !widgetRegistry.has(type as never));
        expect(missing).toEqual([]);
    });

    it('normalizes registered widget IDs that are intentionally absent from the library catalogue', () => {
        const hiddenRegisteredTypes = registeredTypes.filter((type) => !declaredTypes.includes(type));
        expect(hiddenRegisteredTypes).toEqual(expect.arrayContaining([
            'ai_copilot',
            'dividend_ladder',
            'market_heatmap',
            'rs_ranking',
        ]));
        expect(hiddenRegisteredTypes.every((type) => normalizeWidgetType(type) === type)).toBe(true);
        expect(normalizeWidgetType('invalid')).toBeNull();
    });

    const isRenderableComponent = (value: unknown): boolean => {
        if (typeof value === 'function') return true;
        // React.memo / forwardRef components are objects carrying a $$typeof tag.
        return typeof value === 'object' && value !== null && '$$typeof' in value;
    };

    it('keeps one stable lazy component for each registry entry', async () => {
        for (const type of registeredTypes) {
            const entry = widgetRegistry.get(type as never);
            const component = entry?.component;
            await entry?.lazyComponent();
            expect(widgetRegistry.get(type as never)?.component).toBe(component);
        }
    });

    it('registers a loader that resolves to a component', async () => {
        for (const type of registeredTypes) {
            const entry = widgetRegistry.get(type as never);
            expect(entry).toBeDefined();
            const resolved = await entry!.lazyComponent();
            expect(isRenderableComponent(resolved.default)).toBe(true);
        }
    });

    it('identifies placeholder entries without unregistering them', () => {
        expect(isWidgetPlaceholder('valuation_multiples_chart')).toBe(true);
        expect(widgetRegistry.has('valuation_band')).toBe(true);
        expect(isWidgetPlaceholder('price_chart')).toBe(false);
        expect(isWidgetPlaceholder('signal_summary')).toBe(false);
        expect(isWidgetPlaceholder('obv_divergence')).toBe(false);
        expect(isWidgetPlaceholder('source_transparent_research_notebook')).toBe(false);
        expect(isWidgetPlaceholder('earnings_season_monitor')).toBe(false);
    });

    it('wires the QA-reported and system-default widgets to real modules', async () => {
        const activatedTypes = [
            'volume_analysis',
            'atr_regime',
            'quant_summary',
            'fibonacci',
            'ichimoku',
            'drawdown_recovery',
            'world_news_live_stream',
            'world_news_sources',
            'gap_fill_stats',
            'footprint_proxy',
        ];

        for (const type of activatedTypes) {
            expect(isWidgetPlaceholder(type as never)).toBe(false);
            const resolved = await widgetRegistry.get(type as never)?.lazyComponent();
            expect(isRenderableComponent(resolved?.default)).toBe(true);
        }
    });

    it('keeps system-default dashboards free of placeholder widgets', () => {
        const defaultWidgetTypes = [createMainSystemDashboard(), createGlobalMarketsDashboard()]
            .flatMap((dashboard) => dashboard.tabs)
            .flatMap((tab) => tab.widgets)
            .map((widget) => widget.type);

        expect(defaultWidgetTypes.filter((type) => isWidgetPlaceholder(type))).toEqual([]);
    });

    it('activates only the Wave 12 placeholders with resolvable loaders', async () => {
        for (const id of ['bank_metrics', 'valuation_band', 'cashflow_waterfall', 'technical_summary']) {
            expect(isWidgetPlaceholder(id as never)).toBe(false);
            const resolved = await widgetRegistry.get(id as never)?.lazyComponent();
            expect(isRenderableComponent(resolved?.default)).toBe(true);
        }
        expect(isWidgetPlaceholder('valuation_multiples_chart')).toBe(true);
    });

    it('loads the source-transparent research notebook component', async () => {
        const entry = widgetRegistry.get('source_transparent_research_notebook' as never);
        const resolved = await entry?.lazyComponent();
        expect(resolved?.default).toBeDefined();
    });

    it('activates the Wave 9.6 market-analysis widgets with resolvable lazy loaders', async () => {
        for (const id of ['transaction_flow', 'industry_bubble', 'sector_board', 'money_flow_trend', 'correlation_matrix']) {
            expect(isWidgetPlaceholder(id as never)).toBe(false);
            const resolved = await widgetRegistry.get(id as never)?.lazyComponent();
            expect(isRenderableComponent(resolved?.default)).toBe(true);
        }
    });

    it('covers the prediction-market family introduced in Phase 7', () => {
        for (const id of ['polymarket', 'kalshi', 'election_odds', 'prediction_movers', 'macro_calibration', 'consensus_odds']) {
            expect(widgetRegistry.has(id as never)).toBe(true);
        }
    });
});
