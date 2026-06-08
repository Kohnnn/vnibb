'use client';

import { useEffect } from 'react';

/**
 * Nudges container-measuring chart embeds (Recharts `ResponsiveContainer`,
 * TradingView iframes) to re-measure after a layout change that does not itself
 * fire a window resize — e.g. switching tabs/dashboards, grid breakpoint changes,
 * or sidebar resizes.
 *
 * Historically this exact timeout + double-rAF + `window.dispatchEvent(new Event('resize'))`
 * sequence was duplicated in `DashboardGrid` and `DashboardClient`. It is centralised
 * here so there is one tuned implementation. Prefer `ChartHost` (ResizeObserver-based)
 * for new chart widgets; this global nudge remains the safety net for embeds that only
 * listen to window resize.
 *
 * @param deps re-run the nudge whenever these change
 * @param delayMs initial debounce before the double-rAF dispatch
 */
export function useResizeNudge(deps: ReadonlyArray<unknown>, delayMs = 140) {
    useEffect(() => {
        if (typeof window === 'undefined') return;

        let timeoutId: number | undefined;
        let frameA: number | undefined;
        let frameB: number | undefined;

        timeoutId = window.setTimeout(() => {
            frameA = window.requestAnimationFrame(() => {
                frameB = window.requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
            });
        }, delayMs);

        return () => {
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            if (frameA !== undefined) window.cancelAnimationFrame(frameA);
            if (frameB !== undefined) window.cancelAnimationFrame(frameB);
        };
    }, deps);
}
