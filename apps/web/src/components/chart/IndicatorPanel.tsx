'use client';

import { memo } from 'react';
import { Layers, Check, X, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IndicatorConfig {
  id: string;
  name: string;
  type: 'overlay' | 'oscillator';
  enabled: boolean;
}

interface IndicatorPanelProps {
  configs: IndicatorConfig[];
  onToggle: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function IndicatorPanel({ configs, onToggle, isOpen, onClose }: IndicatorPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute top-12 right-2 w-64 bg-[var(--bg-dropdown)] border border-[var(--border-default)] rounded-xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
      <div className="p-3 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
            <Layers size={14} className="text-blue-500" />
            <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Indicators</span>
        </div>
        <button
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose();
            }
          }}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Close indicators panel"
        >
            <X size={14} />
        </button>
      </div>

      <div className="p-2 space-y-4 max-h-80 overflow-y-auto scrollbar-hide">
        <div>
            <div className="text-[9px] uppercase text-[var(--text-muted)] font-black mb-1.5 px-2 tracking-widest">Overlays</div>
            <div className="grid grid-cols-1 gap-0.5">
                {configs.filter(c => c.type === 'overlay').map(indicator => (
                    <button
                        key={indicator.id}
                        onClick={() => onToggle(indicator.id)}
                        className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all",
                            indicator.enabled 
                                ? "bg-blue-600/10 text-blue-400 font-bold" 
                                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                        )}
                    >
                        <span>{indicator.name}</span>
                        {indicator.enabled && <Check size={12} />}
                    </button>
                ))}
            </div>
        </div>

        <div>
            <div className="text-[9px] uppercase text-[var(--text-muted)] font-black mb-1.5 px-2 tracking-widest">Oscillators</div>
            <div className="grid grid-cols-1 gap-0.5">
                {configs.filter(c => c.type === 'oscillator').map(indicator => (
                    <button
                        key={indicator.id}
                        onClick={() => onToggle(indicator.id)}
                        className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all",
                            indicator.enabled 
                                ? "bg-blue-600/10 text-blue-400 font-bold" 
                                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                        )}
                    >
                        <span>{indicator.name}</span>
                        {indicator.enabled && <Check size={12} />}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="p-2 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]/60 flex justify-center">
         <button className="flex items-center gap-1.5 text-[9px] font-black uppercase text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <Settings2 size={10} />
            Configure Params
         </button>
      </div>
    </div>
  );
}

export default memo(IndicatorPanel);
