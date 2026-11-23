// Subsidiaries Widget - Company subsidiaries and affiliates

'use client';

import { Building } from 'lucide-react';
import { useSubsidiaries } from '@/lib/queries';
import type { SubsidiaryData } from '@/types/equity';
import { CompanyReferenceWidget } from './CompanyReferenceWidget';

interface SubsidiariesWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined) return 'n/a';
    return `${pct.toFixed(1)}%`;
}

function exportSubsidiary({ symbol, company_name, ownership_pct }: SubsidiaryData) {
    // The current reference response does not establish currency and scale for charter capital.
    return { symbol, company_name, ownership_pct };
}

export function SubsidiariesWidget({ symbol, onDataChange }: SubsidiariesWidgetProps) {
    const query = useSubsidiaries(symbol);
    return (
        <CompanyReferenceWidget
            type="subsidiaries"
            symbol={symbol}
            label="Subsidiaries"
            icon={<Building size={12} aria-hidden="true" />}
            query={query}
            onDataChange={onDataChange}
            exportRow={exportSubsidiary}
            renderRow={(sub, index) => (
                <div
                    key={index}
                    className="rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]"
                >
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <p className="break-words whitespace-normal text-sm font-medium text-[var(--text-primary)]" title={sub.company_name || ''}>
                                {sub.company_name || 'Unnamed'}
                            </p>
                        </div>
                        <div
                            className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                                (sub.ownership_pct || 0) >= 50
                                    ? 'bg-[var(--color-state-bg)] text-[var(--color-accent-primary)]'
                                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                            }`}
                        >
                            {formatPct(sub.ownership_pct)}
                        </div>
                    </div>
                </div>
            )}
        />
    );
}
