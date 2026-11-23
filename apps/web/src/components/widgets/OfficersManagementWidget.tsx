// Officers/Management Widget - Company leadership

'use client';

import { UserCircle, Briefcase } from 'lucide-react';
import { useOfficers } from '@/lib/queries';
import type { OfficerData } from '@/types/equity';
import { CompanyReferenceWidget } from './CompanyReferenceWidget';
import { formatVietnameseTitle, translateVietnameseTitle } from '@/lib/vietnameseTitles';

interface OfficersManagementWidgetProps {
    id?: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatShares(shares: number | null | undefined): string {
    if (!shares) return 'n/a';
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(2)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(1)}K`;
    return shares.toLocaleString();
}

function exportOfficer({ symbol, name, position, shares_owned }: OfficerData) {
    return { symbol, name, position, shares_owned };
}

export function OfficersManagementWidget({ symbol, onDataChange }: OfficersManagementWidgetProps) {
    const query = useOfficers(symbol);
    return (
        <CompanyReferenceWidget
            type="officers_management"
            symbol={symbol}
            label="Executives"
            icon={<Briefcase size={12} aria-hidden="true" />}
            query={query}
            onDataChange={onDataChange}
            exportRow={exportOfficer}
            renderRow={(officer, index) => (
                <div
                    key={index}
                    className="flex items-start gap-2 rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]"
                >
                    <div className="p-1.5 bg-[var(--color-state-bg)] rounded-full">
                        <UserCircle size={16} className="text-[var(--color-accent-primary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="break-words whitespace-normal text-sm font-medium text-[var(--text-primary)]">
                            {officer.name || 'Unknown'}
                        </p>
                        <p
                            className="break-words whitespace-normal text-xs text-[var(--text-muted)]"
                            title={translateVietnameseTitle(officer.position) || officer.position || 'Executive'}
                        >
                            {officer.position ? formatVietnameseTitle(officer.position) : 'Executive'}
                        </p>
                        {officer.shares_owned && (
                            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                Owns: {formatShares(officer.shares_owned)} shares
                            </p>
                        )}
                    </div>
                </div>
            )}
        />
    );
}
