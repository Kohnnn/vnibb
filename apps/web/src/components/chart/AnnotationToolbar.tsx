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
    <div className="flex items-center gap-2 p-1 bg-gray-900 border border-gray-800 rounded-lg">
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
                    : "text-gray-500 hover:text-white hover:bg-gray-800"
            )}
            title={tool.label}
          >
            <tool.icon size={14} />
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-gray-800 mx-1" />

      {/* Color picker */}
      <div className="relative group">
        <button
          className="p-1.5 rounded hover:bg-gray-800 transition-colors flex items-center gap-1"
          title="Color"
        >
          <div 
            className="w-3.5 h-3.5 rounded-full border border-white/20"
            style={{ backgroundColor: activeColor }}
          />
          <ChevronDown size={10} className="text-gray-600" />
        </button>
        
        {/* Color dropdown */}
        <div className="absolute top-full left-0 mt-1 hidden group-hover:grid grid-cols-4 gap-1 p-2 bg-gray-900 border border-gray-800 rounded-lg shadow-2xl z-50">
          {ANNOTATION_COLORS.map(color => (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              className={cn(
                "w-4 h-4 rounded-full border border-transparent transition-all",
                activeColor === color ? "border-white scale-125" : "hover:scale-110"
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <div className="w-px h-4 bg-gray-800 mx-1" />

      {/* Clear all */}
      <button
        onClick={onClearAll}
        disabled={annotationCount === 0}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Clear all annotations"
      >
        <Trash2 size={12} />
        <span className="hidden sm:inline">Clear ({annotationCount})</span>
      </button>
    </div>
  );
}
