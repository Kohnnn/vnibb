// Header component with symbol search

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    Search,
    User,
    Edit,
    Check,
    Bot,
    RotateCcw,
    X,
    Link as LinkIcon,
    LayoutGrid,
    MoreHorizontal,
    Moon,
    Sun,
} from 'lucide-react';
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel';
import { ConnectionStatus } from '../ui/ConnectionStatus';
import { useTheme } from '@/contexts/ThemeContext';
import type { UnitDisplay } from '@/lib/units';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const UNIT_OPTIONS: Array<{ value: UnitDisplay; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'K', label: 'K' },
    { value: 'M', label: 'M' },
    { value: 'B', label: 'B' },
    { value: 'raw', label: 'Raw' },
];


interface HeaderProps {
    currentSymbol: string;
    onSymbolChange: (symbol: string) => void;
    isEditing?: boolean;
    onEditToggle?: () => void;
    onAIClick?: () => void;
    onResetLayout?: () => void;
    onAutoFitLayout?: () => void;
    onCollapseAll?: () => void;
    onExpandAll?: () => void;
    unitDisplay?: UnitDisplay;
    onUnitDisplayChange?: (value: UnitDisplay) => void;
}

export function Header({
    currentSymbol,
    onSymbolChange,
    isEditing = false,
    onEditToggle,
    onAIClick,
    onResetLayout,
    onAutoFitLayout,
    onCollapseAll,
    onExpandAll,
    unitDisplay = 'auto',
    onUnitDisplayChange
}: HeaderProps) {
    const [searchValue, setSearchValue] = useState(currentSymbol);
    const [isSearching, setIsSearching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const hasActionMenu = Boolean(onAutoFitLayout || onResetLayout || onCollapseAll || onExpandAll || onEditToggle);
    const { resolvedTheme, setTheme } = useTheme();

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

    const toggleTheme = useCallback(() => {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    }, [resolvedTheme, setTheme]);

    return (
        <header className="h-12 bg-[var(--bg-secondary)]/90 backdrop-blur-sm border-b border-[var(--border-color)] sticky top-0 z-40">
            <div className="h-full flex items-center justify-between px-4">
                {/* Search Bar */}
                <div className="flex-1 max-w-sm">
                    <div className="relative">
                        <Search
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                            size={14}
                        />
                        <input
                            ref={inputRef}
                            type="text"
                            aria-label="Search symbol"
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
                bg-[var(--bg-tertiary)] border border-[var(--border-color)]
                text-[var(--text-primary)] placeholder-[var(--text-muted)]
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
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                                title="Clear search"
                                aria-label="Clear search"
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
                            <span className="text-xs text-[var(--text-muted)]">Viewing:</span>
                            <span className="ml-1.5 text-sm font-semibold text-[var(--text-primary)]">
                                {currentSymbol}
                            </span>
                        </div>
                        <LinkIcon size={12} className="text-blue-500 opacity-50" />
                    </div>
                    <div className="h-4 w-[1px] bg-[var(--border-color)]" />
                    <ConnectionStatus />
                </div>

                {onUnitDisplayChange && (
                    <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-1 py-1">
                        <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                            Unit
                        </span>
                        {UNIT_OPTIONS.map((option) => {
                            const isActive = unitDisplay === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onUnitDisplayChange(option.value)}
                                    className={cn(
                                        'rounded px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
                                        isActive
                                            ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]/70 border border-transparent'
                                    )}
                                    title={`Display numbers as ${option.label}`}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                )}


                {/* Actions */}
                <div className="flex items-center gap-1 md:gap-2">
                    {hasActionMenu && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-[#1e2a3b]/50 text-gray-300 hover:bg-[#1e2a3b] transition-colors"
                                    title="Dashboard actions"
                                >
                                    <MoreHorizontal size={14} />
                                    <span className="hidden md:inline text-xs font-medium">Actions</span>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-[#0b1021] border border-[#1e2a3b] min-w-[180px]">
                                {onAutoFitLayout && (
                                    <DropdownMenuItem onClick={onAutoFitLayout} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                        Auto-fit layout
                                    </DropdownMenuItem>
                                )}
                                {onResetLayout && (
                                    <DropdownMenuItem onClick={onResetLayout} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                        Reset layout
                                    </DropdownMenuItem>
                                )}
                                {(onCollapseAll || onExpandAll) && <DropdownMenuSeparator className="bg-[#1e2a3b]" />}
                                {onCollapseAll && (
                                    <DropdownMenuItem onClick={onCollapseAll} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                        Collapse all widgets
                                    </DropdownMenuItem>
                                )}
                                {onExpandAll && (
                                    <DropdownMenuItem onClick={onExpandAll} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                        Expand all widgets
                                    </DropdownMenuItem>
                                )}
                                {onUnitDisplayChange && (
                                    <>
                                        <DropdownMenuSeparator className="bg-[#1e2a3b]" />
                                        <DropdownMenuItem className="text-[10px] uppercase tracking-wider text-gray-500 focus:bg-transparent focus:text-gray-500">
                                            Unit display ({unitDisplay})
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('auto')} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                            Auto scale
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('raw')} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                            Raw values
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('M')} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                            Million
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('B')} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                            Billion
                                        </DropdownMenuItem>
                                    </>
                                )}
                                {onEditToggle && (
                                    <>
                                        <DropdownMenuSeparator className="bg-[#1e2a3b]" />
                                        <DropdownMenuItem onClick={onEditToggle} className="text-xs text-gray-300 hover:bg-[#1e2a3b]/60">
                                            {isEditing ? 'Lock Editing' : 'Unlock Editing'}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    <button
                        onClick={toggleTheme}
                        className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors border border-[var(--border-color)]"
                        title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                        <span className="hidden md:inline text-xs font-medium">
                            {resolvedTheme === 'dark' ? 'Light' : 'Dark'}
                        </span>
                    </button>
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

                    {/* Auto-fit Layout Button */}
                    {onAutoFitLayout && (
                        <button
                            onClick={onAutoFitLayout}
                            className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-500/20 transition-colors"
                            title="Auto-arrange widgets into a neat grid"
                        >
                            <LayoutGrid size={14} />
                            <span className="hidden md:inline text-xs font-medium">Auto-fit</span>
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
