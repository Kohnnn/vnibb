'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Star, Plus, Trash2, Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActiveFilter } from './FilterBar';
import type { FilterGroup } from './FilterBuilderPanel';

export interface SavedScreen {
  id: string;
  name: string;
  quickFilters: ActiveFilter[];
  advancedFilters?: FilterGroup | null;
  columns: string[];
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  market?: string;
  viewMode?: 'table' | 'chart' | 'performance';
  isBuiltIn?: boolean;
}

const BUILT_IN_SCREENS: SavedScreen[] = [
  { id: 'all', name: 'All Stocks', quickFilters: [], columns: [], sortField: 'market_cap', sortOrder: 'desc', isBuiltIn: true },
  {
    id: 'gainers',
    name: 'Top Gainers',
    quickFilters: [{ id: 'change_1d', value: { gte: 5 }, displayValue: 'Gainers (+5%)' }],
    columns: ['ticker', 'price', 'change_1d', 'volume', 'market_cap'],
    sortField: 'change_1d',
    sortOrder: 'desc',
    isBuiltIn: true,
  },
  {
    id: 'losers',
    name: 'Top Losers',
    quickFilters: [{ id: 'change_1d', value: { lt: -5 }, displayValue: 'Losers (-5%)' }],
    columns: ['ticker', 'price', 'change_1d', 'volume', 'market_cap'],
    sortField: 'change_1d',
    sortOrder: 'asc',
    isBuiltIn: true,
  },
  {
    id: 'active',
    name: 'Most Active',
    quickFilters: [],
    columns: ['ticker', 'price', 'change_1d', 'volume', 'market_cap'],
    sortField: 'volume',
    sortOrder: 'desc',
    isBuiltIn: true,
  },
  {
    id: 'rs-leaders',
    name: 'RS Leaders',
    quickFilters: [{ id: 'rs_rating', value: { gte: 80 }, displayValue: 'RS 80+' }],
    columns: ['ticker', 'price', 'change_1d', 'rs_rating', 'perf_1m', 'perf_3m'],
    sortField: 'rs_rating',
    sortOrder: 'desc',
    isBuiltIn: true,
  },
  {
    id: 'value-hunters',
    name: 'Value Hunters',
    quickFilters: [
      { id: 'pe', value: { lt: 12 }, displayValue: 'P/E < 12' },
      { id: 'pb', value: { lt: 2 }, displayValue: 'P/B < 2' },
      { id: 'roe', value: { gte: 15 }, displayValue: 'ROE > 15%' },
    ],
    columns: ['ticker', 'market_cap', 'pe', 'pb', 'roe', 'dividend_yield'],
    sortField: 'pe',
    sortOrder: 'asc',
    isBuiltIn: true,
  },
];

interface SavedScreensDropdownProps {
  activeScreenId: string;
  onSelect: (screen: SavedScreen) => void;
  customScreens: SavedScreen[];
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}

export function SavedScreensDropdown({
  activeScreenId,
  onSelect,
  customScreens,
  onSave,
  onDelete,
}: SavedScreensDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const allScreens = [...BUILT_IN_SCREENS, ...customScreens];
  const currentScreen = allScreens.find(s => s.id === activeScreenId) || BUILT_IN_SCREENS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
            "flex h-8 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-[11px] font-bold uppercase tracking-tight text-[var(--text-primary)] transition-all hover:bg-[var(--bg-tertiary)]",
            isOpen && "border-blue-500 bg-[var(--bg-tertiary)]"
        )}
      >
        <Bookmark size={12} className="text-blue-500" />
        <span className="truncate max-w-[100px]">{currentScreen.name}</span>
        <ChevronDown size={10} className={cn("transition-transform duration-200 opacity-50", isOpen ? 'rotate-180' : '')} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-[130] mt-2 w-64 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-2xl duration-200 animate-in fade-in slide-in-from-top-1">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
             <h4 className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Screener Presets</h4>
          </div>

          <div className="max-h-72 overflow-y-auto p-1 scrollbar-hide">
            {/* Built-in screens */}
            <div className="mb-2">
                <div className="px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Standard</div>
                {BUILT_IN_SCREENS.map((screen) => (
                <button
                    key={screen.id}
                    onClick={() => { onSelect(screen); setIsOpen(false); }}
                    className={cn(
                        "w-full flex items-center gap-2 px-2 py-2 text-left text-[11px] font-medium rounded transition-colors group",
                        activeScreenId === screen.id ? 'bg-blue-600/10 text-blue-400' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    )}
                >
                    <Star size={10} className={cn(activeScreenId === screen.id ? "fill-blue-500 text-blue-500" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]")} />
                    {screen.name}
                </button>
                ))}
            </div>

            {/* Custom screens */}
            {customScreens.length > 0 && (
                <div className="mb-1 border-t border-[var(--border-subtle)] pt-1">
                    <div className="px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-[var(--text-muted)]">My Screens</div>
                    {customScreens.map((screen) => (
                    <div
                        key={screen.id}
                        className="flex items-center group px-1"
                    >
                        <button
                            onClick={() => { onSelect(screen); setIsOpen(false); }}
                            className={cn(
                                "flex-1 flex items-center gap-2 px-2 py-2 text-left text-[11px] font-medium rounded transition-colors",
                                activeScreenId === screen.id ? 'bg-blue-600/10 text-blue-400' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                            )}
                        >
                            <Bookmark size={10} className={activeScreenId === screen.id ? "fill-blue-500 text-blue-500" : "text-[var(--text-muted)]"} />
                            {screen.name}
                        </button>
                        <button
                            onClick={() => onDelete(screen.id)}
                            className="p-2 text-[var(--text-muted)] opacity-0 transition-colors group-hover:opacity-100 hover:text-red-500"
                        >
                            <Trash2 size={10} />
                        </button>
                    </div>
                    ))}
                </div>
            )}
          </div>

          {/* Save new screen */}
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Save current as..."
                className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[10px] text-[var(--text-primary)] outline-none placeholder-[var(--text-muted)] focus:border-blue-500"
              />
              <button
                disabled={!newName.trim()}
                onClick={() => {
                  if (newName.trim()) {
                    onSave(newName.trim());
                    setNewName('');
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
