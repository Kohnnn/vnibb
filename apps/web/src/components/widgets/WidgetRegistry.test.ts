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
import { widgetDefinitions } from '@/data/widgetDefinitions';

describe('WidgetRegistry completeness', () => {
    const declaredTypes = widgetDefinitions.map((entry: { type: string }) => entry.type);
    const registeredTypes = Array.from(widgetRegistry.keys()) as string[];

    it('exposes every widget ID declared in widgetDefinitions.ts', () => {
        const missing = declaredTypes.filter((type: string) => !widgetRegistry.has(type as never));
        expect(missing).toEqual([]);
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
