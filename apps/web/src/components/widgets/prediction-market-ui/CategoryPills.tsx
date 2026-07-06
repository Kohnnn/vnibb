'use client';

/**
 * CategoryPills — multi-select chip row for category filters.
 *
 * Used by PredictionMarketSourceWidget and ElectionOddsWidget. Each pill
 * is a server-side filter applied via the ``category`` query parameter;
 * selecting "All" sends no category at all.
 */

export interface CategoryPillsProps {
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly selected: ReadonlySet<string>;
    readonly onToggle: (value: string) => void;
    readonly allLabel?: string;
}

export function CategoryPills({ options, selected, onToggle, allLabel = 'All' }: CategoryPillsProps) {
    const allSelected = selected.size === 0;
    return (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Category filters">
            <button
                type="button"
                onClick={() => {
                    if (!allSelected) {
                        // Replace (deselect all) by clearing the set.
                        [...selected].forEach((value) => onToggle(value));
                    }
                }}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    allSelected
                        ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                        : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                aria-pressed={allSelected}
            >
                {allLabel}
            </button>
            {options.map((option) => {
                const active = selected.has(option.value);
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onToggle(option.value)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                            active
                                ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                        aria-pressed={active}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}