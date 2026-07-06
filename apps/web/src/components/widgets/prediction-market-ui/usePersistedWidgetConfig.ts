'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * usePersistedWidgetConfig — minimal localStorage-backed widget config hook.
 *
 * Reads a JSON object from localStorage on mount, returns the merged state,
 * and writes back on every set. Used by widgets that want to remember
 * user choices (window hours, sort direction, etc.) without dragging in
 * a full settings library.
 */

export function usePersistedWidgetConfig<T extends object>(
    key: string,
    defaults: T,
): [T, (next: Partial<T>) => void, () => void] {
    const [state, setState] = useState<T>(() => {
        if (typeof window === 'undefined') {
            return defaults;
        }
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return defaults;
            const parsed = JSON.parse(raw) as T;
            return { ...defaults, ...parsed } as T;
        } catch {
            return defaults;
        }
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(key, JSON.stringify(state));
        } catch {
            // Storage may be disabled (e.g. private mode). Silently
            // degrade so the widget keeps working in-memory.
        }
    }, [key, state]);

    const update = useCallback(
        (next: Partial<T>) => {
            setState((prev) => ({ ...prev, ...next }));
        },
        [],
    );

    const reset = useCallback(() => {
        setState(defaults);
    }, [defaults]);

    return [state, update, reset];
}