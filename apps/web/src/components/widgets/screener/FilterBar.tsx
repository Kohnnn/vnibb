'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Filter } from 'lucide-react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { FilterPill } from './FilterPill';
import { cn } from '@/lib/utils';

const AVAILABLE_FILTERS = [
  {
    id: 'price',
    label: 'Price',
    presets: [
      { label: 'Under 10k', value: { lt: 10000 } },
      { label: '10k - 50k', value: { gte: 10000, lt: 50000 } },
      { label: 'Above 50k', value: { gte: 50000 } },
    ],
  },
  {
    id: 'market_cap',
    label: 'Market Cap',
    presets: [
      { label: 'Large (>10T)', value: { gte: 10e12 } },
      { label: 'Mid (1T-10T)', value: { gte: 1e12, lt: 10e12 } },
      { label: 'Small (<1T)', value: { lt: 1e12 } },
    ],
  },
  {
    id: 'pe',
    label: 'P/E',
    presets: [
      { label: 'Under 10', value: { lt: 10 } },
      { label: '10 - 20', value: { gte: 10, lt: 20 } },
      { label: 'Above 20', value: { gte: 20 } },
    ],
  },
  {
    id: 'change_1d',
    label: 'Change %',
    presets: [
      { label: 'Gainers (+5%)', value: { gte: 5 } },
      { label: 'Losers (-5%)', value: { lt: -5 } },
      { label: 'Flat (±1%)', value: { gte: -1, lt: 1 } },
    ],
  },
  {
    id: 'rs_rating',
    label: 'RS Rating',
    presets: [
      { label: '80+', value: { gte: 80 } },
      { label: '90+', value: { gte: 90 } },
      { label: '50 - 80', value: { gte: 50, lt: 80 } },
    ],
  },
  {
    id: 'roe',
    label: 'ROE',
    presets: [
      { label: 'Above 15%', value: { gte: 15 } },
      { label: 'Above 20%', value: { gte: 20 } },
      { label: 'Below 10%', value: { lt: 10 } },
    ],
  },
  {
    id: 'dividend_yield',
    label: 'Dividend Yield',
    presets: [
      { label: 'Above 3%', value: { gte: 3 } },
      { label: 'Above 5%', value: { gte: 5 } },
      { label: 'Below 2%', value: { lt: 2 } },
    ],
  },
];

export interface ActiveFilter {
  id: string;
  value: any;
  displayValue: string;
}

interface FilterBarProps {
  filters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
  analyticsContext?: {
    widgetId: string;
    symbol?: string;
  };
}

export function FilterBar({ filters, onChange, analyticsContext }: FilterBarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const activeFilterIds = filters.map(f => f.id);
  const availableToAdd = AVAILABLE_FILTERS.filter(f => !activeFilterIds.includes(f.id));

  const addFilter = (filterId: string) => {
    const filter = AVAILABLE_FILTERS.find(f => f.id === filterId);
    if (filter) {
      captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
        control_type: 'screener_filter_add',
        filter_id: filter.id,
        value: filter.id,
        filter_count: filters.length + 1,
        widget_id: analyticsContext?.widgetId,
        widget_type: 'screener',
        symbol: analyticsContext?.symbol,
      });
      onChange([...filters, { id: filter.id, value: null, displayValue: '' }]);
    }
    setShowAddMenu(false);
  };

  const updateFilter = (id: string, value: any, displayValue: string) => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
      control_type: 'screener_filter_update',
      filter_id: id,
      value: displayValue,
      filter_count: filters.length,
      widget_id: analyticsContext?.widgetId,
      widget_type: 'screener',
      symbol: analyticsContext?.symbol,
    });
    onChange(filters.map(f => f.id === id ? { ...f, value, displayValue } : f));
  };

  const removeFilter = (id: string) => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
      control_type: 'screener_filter_remove',
      filter_id: id,
      filter_count: Math.max(0, filters.length - 1),
      widget_id: analyticsContext?.widgetId,
      widget_type: 'screener',
      symbol: analyticsContext?.symbol,
    });
    onChange(filters.filter(f => f.id !== id));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
      <div className="mr-2 flex items-center gap-1.5 border-r border-[var(--border-subtle)] pr-2 text-[var(--text-muted)]">
          <Filter size={12} />
          <span className="text-[10px] font-black uppercase tracking-widest">Filter</span>
      </div>
      
      {filters.map((filter) => {
        const config = AVAILABLE_FILTERS.find(f => f.id === filter.id);
        if (!config) return null;

        return (
          <FilterPill
            key={filter.id}
            label={config.label}
            value={filter.displayValue || null}
            presets={config.presets}
            onSelect={(presetValue) => {
              const displayValue = config.presets.find(p => p.value === presetValue)?.label || '';
              updateFilter(filter.id, presetValue, displayValue);
            }}
            onRemove={() => removeFilter(filter.id)}
          />
        );
      })}

      {/* Add Filter Button */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => {
            const nextOpen = !showAddMenu;
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
              action: nextOpen ? 'open_filter_menu' : 'close_filter_menu',
              widget_id: analyticsContext?.widgetId,
              widget_type: 'screener',
              symbol: analyticsContext?.symbol,
            });
            setShowAddMenu(nextOpen);
          }}
          className={cn(
              "inline-flex items-center gap-1 px-3 h-7 text-[10px] font-bold border border-dashed rounded-full transition-all uppercase tracking-tight",
              showAddMenu 
                ? "bg-blue-600 border-blue-500 text-white"
                : "border-[var(--border-color)] bg-transparent text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]"
          )}
        >
          <Plus size={12} />
          <span>Add</span>
        </button>

        {showAddMenu && (
          <div className="absolute left-0 top-full z-[120] mt-2 w-48 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-2xl duration-200 animate-in fade-in slide-in-from-top-1">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Available Filters</h4>
            </div>
            <div className="p-1 max-h-64 overflow-y-auto scrollbar-hide">
                {availableToAdd.map((filter) => (
                <button
                    key={filter.id}
                    onClick={() => addFilter(filter.id)}
                    className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-blue-600 hover:text-white"
                >
                    {filter.label}
                    <Plus size={10} className="opacity-30" />
                </button>
                ))}
                {availableToAdd.length === 0 && (
                    <div className="py-4 text-center text-[10px] font-bold uppercase italic text-[var(--text-muted)]">All filters added</div>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
