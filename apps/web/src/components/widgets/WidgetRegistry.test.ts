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
import widgetDefinitions from '@/data/widgetDefinitions';

describe('WidgetRegistry completeness', () => {
    const declaredTypes = widgetDefinitions.map((entry: { type: string }) => entry.type);
    const registeredTypes = Array.from(widgetRegistry.keys()) as string[];

    it('exposes every widget ID declared in widgetDefinitions.ts', () => {
        const missing = declaredTypes.filter((type: string) => !widgetRegistry.has(type as never));
        expect(missing).toEqual([]);
    });

    it('registers a loader that resolves to a component', async () => {
        for (const type of registeredTypes) {
            const entry = widgetRegistry.get(type as never);
            expect(entry, `Registry entry missing for ${type}`).toBeDefined();
            const resolved = await entry!.lazyComponent();
            expect(typeof resolved.default, `Loader for ${type} did not yield a component`).toBe('function');
        }
    });

    it('covers the prediction-market family introduced in Phase 7', () => {
        for (const id of ['polymarket', 'kalshi', 'election_odds', 'prediction_movers', 'macro_calibration', 'consensus_odds']) {
            expect(widgetRegistry.has(id as never), `Missing registry entry for ${id}`).toBe(true);
        }
    });
});
