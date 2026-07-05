/**
 * Regression guard for the "Polymarket widget not found" bug.
 *
 * Before this test existed, the registry would silently miss large chunks of
 * catalogue IDs (Polymarket, derivatives, ownership, comparison, etc.) and the
 * "widget not found" message would only surface as a console.warn AFTER the
 * product shipped. This file pins the contract: every `type` declared in
 * widgetDefinitions.ts must have a corresponding entry in WidgetRegistry.
 */

import { widgetRegistry } from './WidgetRegistry';
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

    it('registers a loader that resolves to a component', async () => {
        for (const type of registeredTypes) {
            const entry = widgetRegistry.get(type as never);
            expect(entry).toBeDefined();
            const resolved = await entry!.lazyComponent();
            expect(isRenderableComponent(resolved.default)).toBe(true);
        }
    });

    it('covers the prediction-market family introduced in Phase 7', () => {
        for (const id of ['polymarket', 'kalshi', 'election_odds', 'prediction_movers', 'macro_calibration', 'consensus_odds']) {
            expect(widgetRegistry.has(id as never)).toBe(true);
        }
    });
});
