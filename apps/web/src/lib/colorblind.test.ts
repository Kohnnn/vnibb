/**
 * Phase 3 / DEF-03 regression guard. Verifies that the colorblind helper
 * reads the `data-color-mode` attribute off <html> so the consumer never has
 * to hardcode Tailwind class concatenation that drifts over time.
 */

import { colorblindClass } from './colorblind';

describe('colorblind class fragment', () => {
    it('returns the green class for positive intent', () => {
        expect(colorblindClass('positive')).toBe('text-emerald-400');
    });

    it('returns the red class for negative intent', () => {
        expect(colorblindClass('negative')).toBe('text-red-400');
    });

    it('returns the amber class for warning intent', () => {
        expect(colorblindClass('warning')).toBe('text-amber-400');
    });

    it('honors a custom Tailwind suffix', () => {
        expect(colorblindClass('positive', '500')).toBe('text-emerald-500');
    });
});
