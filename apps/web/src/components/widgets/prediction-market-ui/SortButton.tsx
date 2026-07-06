'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';

/**
 * SortButton — two-state toggle for desc/asc sort.
 *
 * Emits ``onChange`` when the user toggles direction.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortButtonProps {
    readonly label: string;
    readonly initial?: SortDirection;
    readonly onChange: (direction: SortDirection) => void;
}

export function SortButton({ label, initial = 'desc', onChange }: SortButtonProps) {
    const [direction, setDirection] = useState<SortDirection>(initial);
    const toggle = () => {
        const next: SortDirection = direction === 'desc' ? 'asc' : 'desc';
        setDirection(next);
        onChange(next);
    };
    return (
        <button
            type="button"
            onClick={toggle}
            className="inline-flex items-center gap-1 rounded-md border border-default bg-[var(--bg-tertiary)] px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={`Sort by ${label} ${direction}`}
        >
            {label}
            {direction === 'desc' ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />}
        </button>
    );
}