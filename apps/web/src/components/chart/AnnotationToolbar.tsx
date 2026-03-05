'use client';

import { Minus, TrendingUp, Type, MousePointer2, Trash2, Palette, ChevronDown } from 'lucide-react';
import { ANNOTATION_COLORS } from '@/types/annotations';
import { cn } from '@/lib/utils';

interface AnnotationToolbarProps {
  selectedTool: 'select' | 'horizontal' | 'trend' | 'text';
  onToolChange: (tool: 'select' | 'horizontal' | 'trend' | 'text') => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  onClearAll: () => void;
  annotationCount: number;
}

export function AnnotationToolbar({
  selectedTool,
  onToolChange,
  activeColor,
  onColorChange,
  onClearAll,
  annotationCount,
}: AnnotationToolbarProps) {
  const tools = [
    { id: 'select' as const, icon: MousePointer2, label: 'Select' },
    { id: 'horizontal' as const, icon: Minus, label: 'Horizontal Line' },
    { id: 'trend' as const, icon: TrendingUp, label: 'Trend Line' },
    { id: 'text' as const, icon: Type, label: 'Text' },
  ];

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
      {/* Tool buttons */}
      <div className="flex items-center gap-0.5">
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => onToolChange(tool.id)}
            className={cn(
                "p-1.5 rounded transition-all",
                selectedTool === tool.id
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            )}
            title={tool.label}
            aria-label={tool.label}
          >
            <tool.icon size={14} />
          </button>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

      {/* Color picker */}
      <div className="relative group">
        <button
          className="flex items-center gap-1 rounded p-1.5 transition-colors hover:bg-[var(--bg-tertiary)]"
          title="Color"
          aria-label="Annotation color"
        >
          <div 
            className="h-3.5 w-3.5 rounded-full border border-[var(--border-color)]"
            style={{ backgroundColor: activeColor }}
          />
          <ChevronDown size={10} className="text-[var(--text-muted)]" />
        </button>
        
        {/* Color dropdown */}
        <div className="absolute left-0 top-full z-50 mt-1 hidden grid-cols-4 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 shadow-2xl group-hover:grid">
          {ANNOTATION_COLORS.map(color => (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              className={cn(
                "w-4 h-4 rounded-full border border-transparent transition-all",
                activeColor === color ? "scale-125 border-[var(--text-primary)]" : "hover:scale-110"
              )}
              style={{ backgroundColor: color }}
              aria-label={`Set annotation color ${color}`}
            />
          ))}
        </div>
      </div>

      <div className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

      {/* Clear all */}
      <button
        onClick={onClearAll}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClearAll();
          }
        }}
        disabled={annotationCount === 0}
        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        title="Clear all annotations"
        aria-label="Clear all annotations"
      >
        <Trash2 size={12} />
        <span className="hidden sm:inline">Clear ({annotationCount})</span>
      </button>
    </div>
  );
}
