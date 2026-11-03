/**
 * Colorblind mode helper. Exposes a single source of truth for whether the
 * colorblind palette swap is currently active so individual widgets don't
 * have to hardcode Tailwind class concatenation that drifts over time.
 *
 * The color tokens live in src/app/globals.css and are redefined when
 * colorblind mode is active.
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
 * over any hard-coded palette class so the swap keeps working.
 */
const INTENT_CLASS = {
    positive: 'text-[var(--color-positive)]',
    negative: 'text-[var(--color-negative)]',
    warning: 'text-[var(--color-warning)]',
} as const;

export function colorblindClass(intent: 'positive' | 'negative' | 'warning'): string {
    return INTENT_CLASS[intent];
}
