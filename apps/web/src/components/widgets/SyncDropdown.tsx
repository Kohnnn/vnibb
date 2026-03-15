// Sync Dropdown - Manage widget synchronization groups (OpenBB-style)

'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, Plus, Search, ChevronRight, X } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';

interface SyncDropdownProps {
    isOpen: boolean;
    onClose: () => void;
    currentGroupId?: number;
    currentSymbol?: string;
    onGroupChange: (groupId: number | undefined) => void;
    onSymbolChange: (symbol: string) => void;
    dashboardId: string;
}

export function SyncDropdown({
    isOpen,
    onClose,
    currentGroupId,
    currentSymbol,
    onGroupChange,
    onSymbolChange,
    dashboardId,
}: SyncDropdownProps) {
    const { state, createSyncGroup } = useDashboard();
    const [searchTerm, setSearchTerm] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const dashboard = state.dashboards.find(d => d.id === dashboardId);
    const syncGroups = dashboard?.syncGroups || [];

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleCreateGroup = () => {
        const symbol = currentSymbol || DEFAULT_TICKER;
        const newGroup = createSyncGroup(dashboardId, symbol);
        onGroupChange(newGroup.id);
        onClose();
    };

    const handleSymbolSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchTerm.trim()) {
            onSymbolChange(searchTerm.toUpperCase());
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] text-sm shadow-xl duration-100 animate-in fade-in zoom-in-95">
            {/* Ticker Input */}
            <form onSubmit={handleSymbolSubmit} className="border-b border-[var(--border-subtle)] p-2">
                <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={currentSymbol || "Search ticker..."}
                        className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-8 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-blue-500 focus:outline-none"
                    />
                </div>
            </form>

            <div className="max-h-60 overflow-y-auto py-1">
                {/* Available Groups */}
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Sync Groups
                </div>

                {syncGroups.map((group) => (
                    <button
                        key={group.id}
                        onClick={() => {
                            onGroupChange(group.id);
                            onClose();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-600/10 group transition-colors"
                    >
                        <div
                            className="w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center text-white shrink-0"
                            style={{ backgroundColor: group.color }}
                        >
                            {group.id}
                        </div>
                        <span className={`flex-1 ${currentGroupId === group.id ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                            {group.name}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-secondary)]">
                            {group.currentSymbol}
                        </span>
                        {currentGroupId === group.id && (
                            <Check size={14} className="text-blue-400" />
                        )}
                    </button>
                ))}

                {/* Create New Group */}
                <button
                    onClick={handleCreateGroup}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-blue-400 hover:bg-blue-600/10 hover:text-blue-300 transition-colors mt-1"
                >
                    <div className="w-4 h-4 rounded border border-dashed border-blue-500 flex items-center justify-center shrink-0">
                        <Plus size={10} />
                    </div>
                    <span>Create New Group</span>
                </button>

                {/* Unlink / No Group */}
                {currentGroupId !== undefined && (
                    <>
                        <div className="my-1 border-t border-[var(--border-subtle)]" />
                        <button
                            onClick={() => {
                                onGroupChange(undefined);
                                onClose();
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                            <X size={14} />
                            <span>Unlink from Group</span>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
