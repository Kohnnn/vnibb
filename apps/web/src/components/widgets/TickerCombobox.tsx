// Ticker Combobox - OpenBB-style searchable dropdown for ticker selection

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { searchStocks, type StockInfo } from '@/data/stockData';

interface TickerComboboxProps {
    isOpen: boolean;
    onClose: () => void;
    currentSymbol?: string;
    onSelect: (symbol: string) => void;
}

export function TickerCombobox({
    isOpen,
    onClose,
    currentSymbol,
    onSelect,
}: TickerComboboxProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Get filtered results
    const results = searchStocks(query, 8);

    // Focus input and reset state when opened
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            // Small delay to ensure the element is rendered
            setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
        }
    }, [isOpen]);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
    }, [isOpen, onClose]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (results[selectedIndex]) {
                    onSelect(results[selectedIndex].symbol);
                    onClose();
                } else if (query.trim()) {
                    // Allow custom ticker entry
                    onSelect(query.toUpperCase().trim());
                    onClose();
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [results, selectedIndex, query, onSelect, onClose]);

    const handleSelect = (stock: StockInfo) => {
        onSelect(stock.symbol);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            ref={containerRef}
            className="absolute top-full left-0 mt-1 w-72 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
            {/* Search Input */}
            <div className="p-2 border-b border-[#2a2a2a]">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Search ticker"
                        className="w-full bg-transparent border-none pl-8 pr-3 py-1.5 text-white placeholder-gray-600 focus:outline-none text-xs"
                    />
                </div>
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto">
                {/* Section Header */}
                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Top Results
                </div>

                {/* Results List */}
                {results.length === 0 ? (
                    <div className="px-3 py-4 text-center text-gray-500 text-xs">
                        No results for "{query}"
                    </div>
                ) : (
                    <div className="pb-1">
                        {results.map((stock, index) => (
                            <button
                                key={stock.symbol}
                                onClick={() => handleSelect(stock)}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${index === selectedIndex
                                        ? 'bg-blue-600/20'
                                        : 'hover:bg-white/5'
                                    }`}
                            >
                                {/* Ticker Icon */}
                                <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center shrink-0">
                                    <TrendingUp size={10} className="text-blue-400" />
                                </div>

                                {/* Ticker Symbol */}
                                <span className="text-xs font-bold text-white min-w-[48px]">
                                    {stock.symbol}
                                </span>

                                {/* Company Name */}
                                <span className="text-xs text-gray-300 flex-1 truncate">
                                    {stock.name}
                                </span>

                                {/* Type & Exchange */}
                                <span className="text-[10px] text-gray-500 uppercase shrink-0">
                                    {stock.type} · {stock.exchange}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-[#2a2a2a] text-[10px] text-gray-600 flex items-center gap-3">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
            </div>
        </div>
    );
}
