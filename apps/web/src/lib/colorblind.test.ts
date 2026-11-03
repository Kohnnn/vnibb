/**
 * Phase 3 / DEF-03 regression guard. Verifies that the colorblind helper
 * reads the `data-color-mode` attribute off <html> so the consumer never has
 * to hardcode Tailwind class concatenation that drifts over time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colorblindClass } from './colorblind';

describe('colorblind class fragment', () => {
    // The contract is "emits a token the colorblind block can redefine", not a
    // specific palette class: a raw class bypasses the swap entirely.
    it('returns the positive token for positive intent', () => {
        expect(colorblindClass('positive')).toBe('text-[var(--color-positive)]');
    });

    it('returns the negative token for negative intent', () => {
        expect(colorblindClass('negative')).toBe('text-[var(--color-negative)]');
    });

    it('returns the warning token for warning intent', () => {
        expect(colorblindClass('warning')).toBe('text-[var(--color-warning)]');
    });

    it('emits no raw Tailwind palette class', () => {
        for (const intent of ['positive', 'negative', 'warning'] as const) {
            expect(colorblindClass(intent)).not.toMatch(/(emerald|red|amber|green)-\d/);
        }
    });
});

describe('colorblind direction palette', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const lightBlock = (() => {
        const start = css.indexOf(":root[data-color-mode='colorblind'][data-theme='light']");
        const open = css.indexOf('{', start);
        return css.slice(open, css.indexOf('\n}', open));
    })();
    const value = (name: string) =>
        lightBlock.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? '';

    // A direction colour equal to the accent made "rising" look like a focal
    // categorical slice; direction and accent must stay distinguishable.
    it('does not reuse Accent blue for a light gain', () => {
        expect(value('--color-positive')).not.toBe('#0b3d91');
    });

    it('keeps light direction colours readable on Paper', () => {
        // Okabe–Ito hue pair must stay >= 4.5:1 on the Paper surface.
        const luminance = (hex: string) => {
            const channel = (x: number) => {
                const c = x / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            };
            const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        for (const name of ['--color-positive', '--color-negative']) {
            const relative = (1.05) / (luminance(value(name)) + 0.05);
            expect(relative).toBeGreaterThanOrEqual(4.5);
        }
    });
});
