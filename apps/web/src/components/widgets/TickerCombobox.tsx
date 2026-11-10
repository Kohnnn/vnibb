// Ticker Combobox - OpenBB-style searchable dropdown for ticker selection

'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Search, TrendingUp } from 'lucide-react';
import { searchStocks, type StockInfo } from '@/data/stockData';

interface TickerComboboxProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (symbol: string) => void;
    anchorRef: RefObject<HTMLButtonElement | null>;
}

export function TickerCombobox({
    isOpen,
    onClose,
    onSelect,
    anchorRef,
}: TickerComboboxProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<React.CSSProperties>({ position: 'fixed' });

    // Get filtered results
    const normalizedQuery = query.toUpperCase();
    const results = searchStocks(normalizedQuery, 8);

    useLayoutEffect(() => {
        if (!isOpen) return;
        const positionPopup = () => {
            const anchor = anchorRef.current;
            const popup = containerRef.current;
            if (!anchor || !popup) return;
            const rect = anchor.getBoundingClientRect();
            const margin = 8;
            const width = popup.offsetWidth;
            const height = popup.scrollHeight;
            const anchorTop = Math.max(margin, Math.min(rect.top, window.innerHeight - margin));
            const anchorBottom = Math.max(margin, Math.min(rect.bottom, window.innerHeight - margin));
            const below = Math.max(0, window.innerHeight - anchorBottom - margin);
            const above = Math.max(0, anchorTop - margin);
            const showAbove = height > below && above > below;
            const availableHeight = showAbove ? above : below;
            setPosition({
                position: 'fixed',
                top: showAbove ? Math.max(margin, anchorTop - Math.min(height, availableHeight)) : anchorBottom,
                left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
                maxHeight: availableHeight,
            });
        };
        positionPopup();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionPopup);
        if (containerRef.current) observer?.observe(containerRef.current);
        window.addEventListener('resize', positionPopup);
        window.addEventListener('scroll', positionPopup, true);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', positionPopup);
            window.removeEventListener('scroll', positionPopup, true);
        };
    }, [isOpen, anchorRef]);

    useLayoutEffect(() => {
        if (isOpen) inputRef.current?.focus({ preventScroll: true });
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            anchorRef.current?.focus();
            onClose();
        };
        document.addEventListener('keydown', handleEscape, true);
        return () => document.removeEventListener('keydown', handleEscape, true);
    }, [isOpen, onClose, anchorRef]);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) {
                onClose();
            }
        };

        // Add listener after a small delay to avoid immediate close
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose, anchorRef]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(0, Math.min(prev + 1, results.length - 1)));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter': {
                e.preventDefault();
                const symbol = results[selectedIndex]?.symbol ?? query.toUpperCase().trim();
                if (symbol) {
                    anchorRef.current?.focus();
                    onSelect(symbol);
                    onClose();
                }
                break;
            }
        }
    }, [results, selectedIndex, query, onSelect, onClose, anchorRef]);

    const handleSelect = (stock: StockInfo) => {
        anchorRef.current?.focus();
        onSelect(stock.symbol);
        onClose();
    };

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={containerRef}
            data-ticker-combobox=""
            role="dialog"
            aria-label="Select ticker"
            style={position}
            className="z-[140] flex w-[min(18rem,calc(100vw-1rem))] flex-col overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-dropdown)] shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
            {/* Search Input */}
            <div className="p-2 border-b border-[var(--border-default)]">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value.toUpperCase());
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Search ticker"
                        aria-label="Search ticker"
                        className="w-full bg-transparent border-none pl-8 pr-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none text-xs"
                    />
                </div>
            </div>

            {/* Results */}
            <div className="min-h-0 max-h-64 shrink overflow-y-auto">
                {/* Section Header */}
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Top Results
                </div>

                {/* Results List */}
                {results.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[var(--text-muted)] text-xs">
                        No results for "{normalizedQuery}"
                    </div>
                ) : (
                    <div className="pb-1">
                        {results.map((stock, index) => (
                            <button
                                key={`${stock.symbol}-${index}`}
                                onClick={() => handleSelect(stock)}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${index === selectedIndex
                                        ? 'bg-[var(--color-state-bg)]'
                                        : 'hover:bg-[var(--bg-hover)]'
                                    }`}
                            >
                                {/* Ticker Icon */}
                                <div className="w-5 h-5 rounded bg-gradient-to-br from-[var(--color-accent-primary)] to-[var(--color-accent-primary)] flex items-center justify-center shrink-0">
                                    <TrendingUp size={10} className="text-[var(--color-accent-primary)]" />
                                </div>

                                {/* Ticker Symbol */}
                                <span className="text-xs font-bold text-[var(--text-primary)] min-w-[48px]">
                                    {stock.symbol}
                                </span>

                                {/* Company Name */}
                                <span className="text-xs text-[var(--text-secondary)] flex-1 truncate">
                                    {stock.name}
                                </span>

                                {/* Type & Exchange */}
                                <span className="text-[10px] text-[var(--text-muted)] uppercase shrink-0">
                                    {stock.type} · {stock.exchange}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-[var(--border-default)] text-[10px] text-[var(--text-muted)] flex items-center gap-3">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
            </div>
        </div>,
        document.body
    );
}
