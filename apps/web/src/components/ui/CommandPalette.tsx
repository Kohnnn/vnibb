// Command Palette - OpenBB-style Ctrl+K search modal

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, TrendingUp, LayoutDashboard, BarChart3, Table, X } from 'lucide-react';

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    onSymbolSelect: (symbol: string) => void;
    onNavigate?: (tab: string) => void;
}

interface SearchResult {
    type: 'ticker' | 'navigation' | 'action';
    symbol?: string;
    label: string;
    description?: string;
    icon: React.ReactNode;
}

// Popular Vietnam stocks for quick search
const POPULAR_STOCKS = [
    { symbol: 'VNM', name: 'Vinamilk', industry: 'Food & Beverage' },
    { symbol: 'FPT', name: 'FPT Corporation', industry: 'Technology' },
    { symbol: 'VIC', name: 'Vingroup', industry: 'Real Estate' },
    { symbol: 'HPG', name: 'Hoa Phat Group', industry: 'Steel' },
    { symbol: 'VHM', name: 'Vinhomes', industry: 'Real Estate' },
    { symbol: 'MSN', name: 'Masan Group', industry: 'Consumer Goods' },
    { symbol: 'TCB', name: 'Techcombank', industry: 'Banking' },
    { symbol: 'VCB', name: 'Vietcombank', industry: 'Banking' },
    { symbol: 'MWG', name: 'Mobile World', industry: 'Retail' },
    { symbol: 'VRE', name: 'Vincom Retail', industry: 'Retail' },
];

const NAVIGATION_ITEMS = [
    { tab: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
    { tab: 'financials', label: 'Financials', icon: <BarChart3 size={16} /> },
    { tab: 'technicals', label: 'Technical Analysis', icon: <TrendingUp size={16} /> },
    { tab: 'screener', label: 'Screener', icon: <Table size={16} /> },
];

export function CommandPalette({ isOpen, onClose, onSymbolSelect, onNavigate }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter results based on query
    const getResults = useCallback((): SearchResult[] => {
        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase().trim();

        // If empty, show popular stocks
        if (!lowerQuery) {
            POPULAR_STOCKS.slice(0, 6).forEach((stock) => {
                results.push({
                    type: 'ticker',
                    symbol: stock.symbol,
                    label: stock.symbol,
                    description: `${stock.name} · ${stock.industry}`,
                    icon: <TrendingUp size={16} className="text-blue-400" />,
                });
            });
            return results;
        }

        // Search stocks
        POPULAR_STOCKS.filter(
            (stock) =>
                stock.symbol.toLowerCase().includes(lowerQuery) ||
                stock.name.toLowerCase().includes(lowerQuery)
        ).forEach((stock) => {
            results.push({
                type: 'ticker',
                symbol: stock.symbol,
                label: stock.symbol,
                description: `${stock.name} · ${stock.industry}`,
                icon: <TrendingUp size={16} className="text-blue-400" />,
            });
        });

        // Search navigation
        if (lowerQuery.length > 1) {
            NAVIGATION_ITEMS.filter((item) =>
                item.label.toLowerCase().includes(lowerQuery)
            ).forEach((item) => {
                results.push({
                    type: 'navigation',
                    label: `Go to ${item.label}`,
                    description: 'Navigation',
                    icon: item.icon,
                });
            });
        }

        return results.slice(0, 8);
    }, [query]);

    const results = getResults();

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    const selected = results[selectedIndex];
                    if (selected) {
                        if (selected.type === 'ticker' && selected.symbol) {
                            onSymbolSelect(selected.symbol);
                        } else if (selected.type === 'navigation') {
                            // Extract tab from label
                            const tab = NAVIGATION_ITEMS.find(
                                (item) => selected.label.includes(item.label)
                            )?.tab;
                            if (tab && onNavigate) onNavigate(tab);
                        }
                        onClose();
                    }
                    break;
                case 'Escape':
                    onClose();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, results, selectedIndex, onSymbolSelect, onNavigate, onClose]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
                <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl shadow-2xl overflow-hidden">
                    {/* Search Input */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e3a5f]">
                        <Search size={20} className="text-gray-400" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setSelectedIndex(0);
                            }}
                            placeholder="Search ticker, navigate..."
                            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
                        />
                        <kbd className="px-2 py-0.5 text-xs text-gray-500 bg-gray-800 rounded">
                            ESC
                        </kbd>
                    </div>

                    {/* Results */}
                    <div className="max-h-80 overflow-y-auto">
                        {results.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                                No results found for "{query}"
                            </div>
                        ) : (
                            <div className="py-2">
                                {results.map((result, index) => (
                                    <button
                                        key={`${result.type}-${result.label}-${index}`}
                                        onClick={() => {
                                            if (result.type === 'ticker' && result.symbol) {
                                                onSymbolSelect(result.symbol);
                                            } else if (result.type === 'navigation') {
                                                const tab = NAVIGATION_ITEMS.find(
                                                    (item) => result.label.includes(item.label)
                                                )?.tab;
                                                if (tab && onNavigate) onNavigate(tab);
                                            }
                                            onClose();
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${index === selectedIndex
                                                ? 'bg-blue-600/20 text-white'
                                                : 'text-gray-300 hover:bg-gray-800/50'
                                            }`}
                                    >
                                        {result.icon}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium">{result.label}</div>
                                            {result.description && (
                                                <div className="text-xs text-gray-500 truncate">
                                                    {result.description}
                                                </div>
                                            )}
                                        </div>
                                        {result.type === 'ticker' && (
                                            <span className="text-xs text-gray-500">STOCK</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-4 py-2 border-t border-[#1e3a5f] text-xs text-gray-500">
                        <div className="flex items-center gap-4">
                            <span>↑↓ Navigate</span>
                            <span>↵ Select</span>
                        </div>
                        <span>Ctrl+K to open</span>
                    </div>
                </div>
            </div>
        </>
    );
}

// Hook to manage command palette state
export function useCommandPalette() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen((prev) => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((prev) => !prev),
    };
}
