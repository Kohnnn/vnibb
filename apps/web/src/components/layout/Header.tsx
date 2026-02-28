// Header component with symbol search

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
    ChevronRight,
    Moon,
    Sun,
} from 'lucide-react';
import { AlertNotificationPanel } from '../widgets/AlertNotificationPanel';
import { ConnectionStatus } from '../ui/ConnectionStatus';
import { useTheme } from '@/contexts/ThemeContext';
import { useHistoricalPrices, useStockQuote } from '@/lib/queries';
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

const MARKET_TIMEZONE = 'Asia/Ho_Chi_Minh';

function formatHeaderPrice(value: number | null | undefined): string {
    if (value === null || value === undefined) return '--';
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatHeaderPercent(value: number | null | undefined): string {
    if (value === null || value === undefined) return '--';
    const normalized = Math.abs(value) > 1 ? value : value * 100;
    const sign = normalized > 0 ? '+' : '';
    return `${sign}${normalized.toFixed(2)}%`;
}

function getSparklinePoints(values: number[]): string {
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    return values
        .map((value, index) => {
            const x = (index / (values.length - 1)) * 100;
            const y = 100 - ((value - min) / range) * 100;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
}

function getVietnamMarketStatus(reference = new Date()): { label: string; isOpen: boolean } {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: MARKET_TIMEZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(reference);
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

    const isBusinessDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
    const totalMinutes = hour * 60 + minute;
    const morningSession = totalMinutes >= 9 * 60 && totalMinutes <= 11 * 60 + 30;
    const afternoonSession = totalMinutes >= 13 * 60 && totalMinutes <= 15 * 60;
    const isOpen = isBusinessDay && (morningSession || afternoonSession);

    return {
        isOpen,
        label: isOpen ? 'Market Open (HOSE)' : 'Market Closed (HOSE)',
    };
}


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
    const [marketClock, setMarketClock] = useState(() => Date.now());

    const quoteQuery = useStockQuote(currentSymbol, Boolean(currentSymbol));
    const historyQuery = useHistoricalPrices(currentSymbol, {
        interval: '1D',
        enabled: Boolean(currentSymbol),
    });

    const quote = quoteQuery.data;
    const sparklineValues = useMemo(() => {
        const points = historyQuery.data?.data || [];
        return points
            .slice(-20)
            .map((point) => point.close)
            .filter((value): value is number => Number.isFinite(value));
    }, [historyQuery.data]);

    const sparklinePoints = useMemo(() => getSparklinePoints(sparklineValues), [sparklineValues]);
    const quoteIsPositive = (quote?.changePct ?? 0) >= 0;
    const quoteChangeClass = quote?.changePct == null
        ? 'text-[var(--text-muted)]'
        : quoteIsPositive
            ? 'text-emerald-400'
            : 'text-rose-400';
    const marketStatus = useMemo(() => getVietnamMarketStatus(new Date(marketClock)), [marketClock]);

    // Sync searchValue when currentSymbol changes externally (e.g., widget ticker click)
    useEffect(() => {
        if (!isSearching) {
            setSearchValue(currentSymbol);
        }
    }, [currentSymbol, isSearching]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setMarketClock(Date.now());
        }, 60 * 1000);

        return () => window.clearInterval(timer);
    }, []);

    const handleSearch = useCallback(() => {
        const normalized = searchValue.trim().toUpperCase();
        if (normalized) {
            onSymbolChange(normalized);
            setSearchValue(normalized);
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
        <header className="h-14 bg-[var(--bg-secondary)]/95 backdrop-blur-sm border-b border-[var(--border-color)] sticky top-0 z-40">
            <div className="h-full flex items-center justify-between gap-3 px-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="hidden xl:flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        <span>VNIBB</span>
                        <ChevronRight size={11} className="text-[var(--text-muted)]" />
                        <span>Equities</span>
                        <ChevronRight size={11} className="text-[var(--text-muted)]" />
                        <span className="text-[var(--text-primary)]">{currentSymbol}</span>
                    </div>

                    <div className="relative w-full max-w-sm">
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
                                setIsSearching(true);
                                const normalizedCurrent = currentSymbol.trim().toUpperCase();
                                const normalizedSearch = searchValue.trim().toUpperCase();
                                if (normalizedSearch === normalizedCurrent) {
                                    setSearchValue('');
                                } else {
                                    e.target.select();
                                }
                            }}
                            onKeyDown={handleKeyDown}
                            onBlur={() => {
                                setTimeout(() => {
                                    if (isSearching) handleSearch();
                                }, 150);
                            }}
                            placeholder="Search symbol (e.g., VNM, FPT)"
                            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] py-1.5 pl-8 pr-16 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                        />
                        {searchValue && searchValue !== currentSymbol && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchValue(currentSymbol);
                                    setIsSearching(false);
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-10 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                                title="Clear search"
                                aria-label="Clear search"
                            >
                                <X size={12} />
                            </button>
                        )}
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            Cmd+K
                        </span>
                    </div>
                </div>

                <div className="hidden lg:flex items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1">
                        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Viewing</span>
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{currentSymbol}</span>
                        <LinkIcon size={11} className="text-blue-500/70" />
                    </div>

                    <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                            {formatHeaderPrice(quote?.price)}
                        </span>
                        <span className={cn('text-xs font-semibold', quoteChangeClass)}>
                            {formatHeaderPercent(quote?.changePct)}
                        </span>
                        {sparklinePoints && (
                            <svg viewBox="0 0 100 28" className="h-6 w-20" aria-hidden="true">
                                <polyline
                                    fill="none"
                                    stroke={quoteIsPositive ? '#34d399' : '#f87171'}
                                    strokeWidth="2"
                                    points={sparklinePoints}
                                />
                            </svg>
                        )}
                    </div>

                    <div
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                            marketStatus.isOpen
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                        )}
                    >
                        <span
                            className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                marketStatus.isOpen ? 'animate-pulse bg-emerald-400' : 'bg-slate-400'
                            )}
                        />
                        {marketStatus.label}
                    </div>

                    <ConnectionStatus />
                </div>

                {onUnitDisplayChange && (
                    <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-1 py-1">
                        <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
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
                                            ? 'bg-blue-600/15 text-[var(--accent-blue)] border border-blue-500/30'
                                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/70 border border-transparent'
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
                                    className="flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] transition-colors"
                                    title="Dashboard actions"
                                >
                                    <MoreHorizontal size={14} />
                                    <span className="hidden md:inline text-xs font-medium">Actions</span>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                className="bg-[var(--bg-secondary)] border border-[var(--border-color)] min-w-[180px]"
                            >
                                {onAutoFitLayout && (
                                    <DropdownMenuItem onClick={onAutoFitLayout} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                        Auto-fit layout
                                    </DropdownMenuItem>
                                )}
                                {onResetLayout && (
                                    <DropdownMenuItem onClick={onResetLayout} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                        Reset layout
                                    </DropdownMenuItem>
                                )}
                                {(onCollapseAll || onExpandAll) && <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />}
                                {onCollapseAll && (
                                    <DropdownMenuItem onClick={onCollapseAll} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                        Collapse all widgets
                                    </DropdownMenuItem>
                                )}
                                {onExpandAll && (
                                    <DropdownMenuItem onClick={onExpandAll} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                        Expand all widgets
                                    </DropdownMenuItem>
                                )}
                                {onUnitDisplayChange && (
                                    <>
                                        <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                                        <DropdownMenuItem className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] focus:bg-transparent focus:text-[var(--text-muted)]">
                                            Unit display ({unitDisplay})
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('auto')} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                            Auto scale
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('raw')} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                            Raw values
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('M')} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                            Million
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onUnitDisplayChange('B')} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                                            Billion
                                        </DropdownMenuItem>
                                    </>
                                )}
                                {onEditToggle && (
                                    <>
                                        <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                                        <DropdownMenuItem onClick={onEditToggle} className="text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
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
                    {onEditToggle && (
                        <button
                            onClick={onEditToggle}
                            className={`
                  flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md
                  transition-colors font-medium text-xs
                  ${isEditing
                                    ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20'
                                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)]'
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
                    )}

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
                    <button className="hidden sm:block p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <User size={16} />
                    </button>
                </div>
            </div>
        </header>
    );
}
