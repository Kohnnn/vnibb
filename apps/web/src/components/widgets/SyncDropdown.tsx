// Sync Dropdown - Manage widget synchronization groups (OpenBB-style)

'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, Plus, Search, ChevronRight, X } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';

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
        const symbol = currentSymbol || 'VNM';
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
        <div className="absolute top-full left-0 mt-1 w-64 bg-[#0d1f3c] border border-[#1e3a5f] rounded-lg shadow-xl z-20 overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-100">
            {/* Ticker Input */}
            <form onSubmit={handleSymbolSubmit} className="p-2 border-b border-[#1e3a5f]">
                <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={currentSymbol || "Search ticker..."}
                        className="w-full bg-[#1e3a5f]/50 border border-[#1e3a5f] rounded px-8 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-xs"
                    />
                </div>
            </form>

            <div className="max-h-60 overflow-y-auto py-1">
                {/* Available Groups */}
                <div className="px-2 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
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
                        <span className={`flex-1 ${currentGroupId === group.id ? 'text-white font-medium' : 'text-gray-300'}`}>
                            {group.name}
                        </span>
                        <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
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
                        <div className="border-t border-[#1e3a5f] my-1" />
                        <button
                            onClick={() => {
                                onGroupChange(undefined);
                                onClose();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
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
