// Header component with symbol search

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Bell, User, Edit, Check, Bot, RotateCcw, X, Link as LinkIcon } from 'lucide-react';
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel';
import { ConnectionStatus } from '../ui/ConnectionStatus';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';


interface HeaderProps {
    currentSymbol: string;
    onSymbolChange: (symbol: string) => void;
    isEditing?: boolean;
    onEditToggle?: () => void;
    onAIClick?: () => void;
    onResetLayout?: () => void;
}

export function Header({
    currentSymbol,
    onSymbolChange,
    isEditing = false,
    onEditToggle,
    onAIClick,
    onResetLayout
}: HeaderProps) {
    const [searchValue, setSearchValue] = useState(currentSymbol);
    const [isSearching, setIsSearching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync searchValue when currentSymbol changes externally (e.g., widget ticker click)
    useEffect(() => {
        if (!isSearching) {
            setSearchValue(currentSymbol);
        }
    }, [currentSymbol, isSearching]);

    const handleSearch = useCallback(() => {
        if (searchValue.trim()) {
            onSymbolChange(searchValue.trim().toUpperCase());
            setIsSearching(false);
        }
    }, [searchValue, onSymbolChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                handleSearch();
            } else if (e.key === 'Escape') {
                setSearchValue(currentSymbol);
                setIsSearching(false);
            }
        },
        [handleSearch, currentSymbol]
    );

    return (
        <header className="h-12 bg-[#0b1021]/90 backdrop-blur-sm border-b border-[#1e2a3b] sticky top-0 z-40">
            <div className="h-full flex items-center justify-between px-4">
                {/* Search Bar */}
                <div className="flex-1 max-w-sm">
                    <div className="relative">
                        <Search
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                            size={14}
                        />
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchValue}
                            onChange={(e) => {
                                setSearchValue(e.target.value.toUpperCase());
                                setIsSearching(true);
                            }}
                            onFocus={(e) => {
                                e.target.select();
                                setIsSearching(true);
                            }}
                            onKeyDown={handleKeyDown}
                            onBlur={() => {
                                // Small delay to allow clear button click to register
                                setTimeout(() => {
                                    if (isSearching) handleSearch();
                                }, 150);
                            }}
                            placeholder="Search symbol (e.g., VNM, FPT)"
                            className={`
                w-full pl-8 pr-8 py-1.5 rounded-md text-xs
                bg-[#0f1629] border border-[#1e2a3b]
                text-white placeholder-gray-500
                focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20
                transition-all
              `}
                        />
                        {/* Clear button */}
                        {searchValue && searchValue !== currentSymbol && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchValue(currentSymbol);
                                    setIsSearching(false);
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                                title="Clear search"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Current Symbol Display - Hidden on mobile */}
                <div className="hidden md:flex items-center gap-4 mx-6">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center">
                            <span className="text-xs text-gray-500">Viewing:</span>
                            <span className="ml-1.5 text-sm font-semibold text-white">
                                {currentSymbol}
                            </span>
                        </div>
                        <LinkIcon size={12} className="text-blue-500 opacity-50" />
                    </div>
                    <div className="h-4 w-[1px] bg-gray-800" />
                    <ConnectionStatus />
                </div>


                {/* Actions */}
                <div className="flex items-center gap-1 md:gap-2">
                    {/* Reset Layout Button - only show in edit mode */}
                    {isEditing && onResetLayout && (
                        <button
                            onClick={onResetLayout}
                            className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 transition-colors"
                            title="Reset widget positions to default"
                        >
                            <RotateCcw size={14} />
                            <span className="hidden md:inline text-xs font-medium">Reset</span>
                        </button>
                    )}

                    {/* Edit Mode Toggle */}
                    <button
                        onClick={onEditToggle}
                        className={`
              flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md
              transition-colors font-medium text-xs
              ${isEditing
                                ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20'
                                : 'bg-[#1e2a3b]/50 text-gray-300 hover:bg-[#1e2a3b]'
                            }
            `}
                    >
                        {isEditing ? (
                            <>
                                <Check size={14} />
                                <span className="hidden md:inline">Save Layout</span>
                            </>
                        ) : (
                            <>
                                <Edit size={14} />
                                <span className="hidden md:inline">Edit</span>
                            </>
                        )}
                    </button>

                    {/* AI Copilot */}
                    <button
                        onClick={onAIClick}
                        className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-blue-600/15 text-blue-400 hover:bg-blue-600/25 border border-blue-500/20 transition-colors"
                    >
                        <Bot size={14} />
                        <span className="hidden md:inline text-xs font-medium">AI Copilot</span>
                    </button>

                    {/* Notifications - Hidden on small mobile */}
                    <div className="hidden sm:block">
                        <AlertNotificationPanel />
                    </div>

                    {/* Profile - Hidden on small mobile */}
                    <button className="hidden sm:block p-1.5 rounded-md hover:bg-[#1e2a3b] text-gray-400 hover:text-gray-200 transition-colors">
                        <User size={16} />
                    </button>
                </div>
            </div>
        </header>
    );
}
