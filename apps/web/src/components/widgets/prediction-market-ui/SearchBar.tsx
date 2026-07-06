'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * SearchBar — debounced search input.
 *
 * Used by PredictionMarketSourceWidget and ElectionOddsWidget. Emits
 * ``onDebouncedChange`` after ``debounceMs`` of idle so a fresh fetch
 * doesn't fire on every keystroke.
 */

export interface SearchBarProps {
    readonly placeholder?: string;
    readonly initialValue?: string;
    readonly debounceMs?: number;
    readonly onDebouncedChange: (value: string) => void;
}

export function SearchBar({
    placeholder = 'Search markets',
    initialValue = '',
    debounceMs = 220,
    onDebouncedChange,
}: SearchBarProps) {
    const [value, setValue] = useState(initialValue);
    const lastEmitted = useRef(initialValue);
    useEffect(() => {
        if (value === lastEmitted.current) return;
        const timer = window.setTimeout(() => {
            lastEmitted.current = value;
            onDebouncedChange(value);
        }, debounceMs);
        return () => window.clearTimeout(timer);
    }, [value, debounceMs, onDebouncedChange]);
    return (
        <div className="relative flex w-full items-center">
            <Search
                size={13}
                className="pointer-events-none absolute left-2 text-[var(--text-muted)]"
                aria-hidden
            />
            <input
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border border-default bg-[var(--bg-tertiary)] py-1 pl-7 pr-7 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-blue-500/60 focus:outline-none"
                aria-label={placeholder}
            />
            {value.length > 0 && (
                <button
                    type="button"
                    onClick={() => setValue('')}
                    className="absolute right-1 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    aria-label="Clear search"
                >
                    <X size={11} />
                </button>
            )}
        </div>
    );
}