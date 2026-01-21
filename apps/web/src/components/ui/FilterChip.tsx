'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterChipProps {
  label: string;
  value?: string;
  active?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  color?: 'blue' | 'green' | 'red' | 'gray';
  className?: string;
}

const COLORS = {
  blue: 'bg-blue-600/10 text-blue-400 border-blue-500/20 hover:border-blue-500/50',
  green: 'bg-green-600/10 text-green-400 border-green-500/20 hover:border-green-500/50',
  red: 'bg-red-600/10 text-red-400 border-red-500/20 hover:border-red-500/50',
  gray: 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-600',
};

function FilterChipComponent({
  label,
  value,
  active = false,
  onToggle,
  onRemove,
  color = 'blue',
  className,
}: FilterChipProps) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all cursor-pointer select-none",
        active ? COLORS[color] : 'bg-transparent text-gray-600 border-gray-800 hover:border-gray-700 hover:text-gray-400',
        active && "shadow-lg shadow-blue-900/10",
        className
      )}
    >
      <span>{label}</span>
      {value && <span className="text-white ml-0.5">{value}</span>}
      {onRemove && active && (
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 hover:text-white transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export const FilterChip = memo(FilterChipComponent);
export default FilterChip;
