'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterPreset {
  label: string;
  value: any;
}

interface FilterPillProps {
  label: string;
  value: string | null;
  presets: FilterPreset[];
  onSelect: (value: any) => void;
  onRemove: () => void;
}

export function FilterPill({ label, value, presets, onSelect, onRemove }: FilterPillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredPresets = presets.filter(p => 
    p.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <div className={cn(
          "inline-flex items-center rounded-full border h-7 transition-all duration-200 overflow-hidden",
          value
            ? 'bg-blue-600/10 border-blue-500/30 text-blue-300'
            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      )}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-3 h-full text-[10px] font-bold uppercase tracking-tight"
        >
          <span>{label}</span>
          {value && (
              <>
                <span className="font-black text-[var(--text-muted)]">|</span>
                <span className="text-blue-400">{value}</span>
              </>
          )}
          <ChevronDown size={10} className={cn("transition-transform duration-200", isOpen ? 'rotate-180' : '')} />
        </button>
        {value && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex items-center justify-center w-6 h-full hover:bg-red-500/20 text-red-500/60 hover:text-red-400 transition-colors border-l border-blue-500/20"
          >
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full z-[110] mt-2 w-48 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-2xl duration-100 animate-in fade-in zoom-in-95">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[11px] font-medium text-[var(--text-primary)] outline-none placeholder-[var(--text-muted)] focus:border-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1 scrollbar-hide">
            {filteredPresets.map((preset, i) => (
              <button
                key={i}
                onClick={() => {
                  onSelect(preset.value);
                  setIsOpen(false);
                  setSearchQuery('');
                }}
                className="group flex w-full items-center justify-between rounded px-3 py-2 text-left text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-blue-600 hover:text-white"
              >
                {preset.label}
                <ChevronDown size={10} className="opacity-0 group-hover:opacity-50 -rotate-90" />
              </button>
            ))}
            {filteredPresets.length === 0 && (
                <div className="py-4 text-center text-[10px] font-bold uppercase italic text-[var(--text-muted)]">No matches</div>
            )}
          </div>
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
            <button className="w-full py-1 text-center text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] transition-colors hover:text-blue-400">
              Advanced Filter...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
