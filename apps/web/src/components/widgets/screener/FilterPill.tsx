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
            : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
      )}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-3 h-full text-[10px] font-bold uppercase tracking-tight"
        >
          <span>{label}</span>
          {value && (
              <>
                <span className="text-gray-600 font-black">|</span>
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
        <div className="absolute top-full left-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[110] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-gray-800 bg-gray-950/50">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1.5 text-[11px] bg-gray-800 border border-gray-700 rounded text-white outline-none focus:border-blue-500 placeholder-gray-600 font-medium"
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
                className="w-full px-3 py-2 text-left text-[11px] text-gray-400 hover:bg-blue-600 hover:text-white rounded transition-colors font-medium flex items-center justify-between group"
              >
                {preset.label}
                <ChevronDown size={10} className="opacity-0 group-hover:opacity-50 -rotate-90" />
              </button>
            ))}
            {filteredPresets.length === 0 && (
                <div className="py-4 text-center text-[10px] text-gray-600 font-bold uppercase italic">No matches</div>
            )}
          </div>
          <div className="p-2 border-t border-gray-800 bg-gray-950/50">
            <button className="w-full py-1 text-[9px] font-black text-gray-500 hover:text-blue-400 uppercase tracking-widest text-center transition-colors">
              Advanced Filter...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
