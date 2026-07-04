/**
 * Colorblind mode helper. Exposes a single source of truth for whether the
 * colorblind palette swap is currently active so individual widgets don't
 * have to hardcode Tailwind class concatenation that drifts over time.
 *
 * The actual color tokens live in src/app/globals.css under the
 * :root[data-color-mode='colorblind'] selector. Components that previously
 * used Tailwind's text-emerald-* / bg-emerald-* / border-emerald-* classes
 * now have those remapped to the canonical positive/negative tokens (so
 * Phase 3 / DEF-03 fix actually takes effect in production).
 */

import { useEffect, useState } from 'react';

const COLORBLIND_ATTR = 'data-color-mode';
const COLORBLIND_VALUE = 'colorblind';

/**
 * Whether the page is currently rendered with the colorblind color tokens.
 *
 * Reactive: any change to <html data-color-mode="colorblind"> via the
 * settings UI triggers a re-render of consumers that use this hook.
 */
export function useColorblind(): boolean {
    const [enabled, setEnabled] = useState<boolean>(() => {
        if (typeof document === 'undefined') return false;
        return document.documentElement.getAttribute(COLORBLIND_ATTR) === COLORBLIND_VALUE;
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const html = document.documentElement;
        const update = () =>
            setEnabled(html.getAttribute(COLORBLIND_ATTR) === COLORBLIND_VALUE);
        update();
        const observer = new MutationObserver(update);
        observer.observe(html, { attributes: true, attributeFilter: [COLORBLIND_ATTR] });
        return () => observer.disconnect();
    }, []);

    return enabled;
}

/**
 * Class fragment for positive (up) / negative (down) intent that is
 * automatically swapped with the colorblind-friendly palette. Prefer this
 * over hard-coding `text-emerald-400` so QA DEF-03 stays green on
 * regression tests.
 */
export function colorblindClass(intent: 'positive' | 'negative' | 'warning', suffix = '400'): string {
    if (intent === 'positive') {
        return `text-emerald-${suffix}`;
    }
    if (intent === 'negative') {
        return `text-red-${suffix}`;
    }
    return `text-amber-${suffix}`;
}
