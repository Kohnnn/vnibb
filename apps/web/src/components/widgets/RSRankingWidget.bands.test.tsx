import { getRSBg, getRSColor } from './RSRankingWidget';

// An RS rating is an ordinal score, not a gain/loss pair: the ramp must be a
// single hue whose strength rises with the score, never five semantic hues.
const strength = (rating: number) => {
    const match = getRSBg(rating).background.match(/var\((--[a-z-]+)\) (\d+)%/);
    expect(match).not.toBeNull();
    return { token: match![1], pct: Number(match![2]) };
};

describe('RS rating ramp', () => {
    it('uses one accent hue, not a rainbow', () => {
        const tokens = [5, 25, 50, 70, 92].map((rating) => strength(rating).token);
        expect(new Set(tokens)).toEqual(new Set(['--color-accent-primary']));
    });

    it('rises monotonically with the score', () => {
        const pcts = [5, 25, 50, 70, 92].map((rating) => strength(rating).pct);
        expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
        expect(strength(0).pct).toBe(0);
        // 100 maps to the readability cap, not to a solid fill.
        expect(strength(100).pct).toBe(45);
    });

    it('clamps out-of-range scores instead of emitting an invalid tint', () => {
        expect(strength(-40).pct).toBe(0);
        expect(strength(240).pct).toBe(strength(100).pct);
    });

    it('never reaches a solid fill, so the accent label stays readable', () => {
        // Regression: 100% accent fill under accent text was 1:1 contrast and
        // hid a perfect score entirely.
        const maxTint = Math.max(...[0, 25, 50, 75, 90, 100].map((r) => strength(r).pct));
        expect(maxTint).toBeLessThanOrEqual(45);
        expect(maxTint).toBeGreaterThan(0);
    });

    it('does not colour a mid or low score as a loss', () => {
        // The old scale painted <20 red, which read as a loss the number lacks.
        expect(getRSColor()).not.toMatch(/negative|red/);
        expect(getRSColor()).toBe('text-[var(--text-primary)]');
    });
});
