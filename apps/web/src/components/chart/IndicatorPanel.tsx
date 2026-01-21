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
    <div className="absolute top-12 right-2 w-64 bg-[#0a0a0a] border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
      <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-[#0d0d0d]">
        <div className="flex items-center gap-2">
            <Layers size={14} className="text-blue-500" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Indicators</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={14} />
        </button>
      </div>

      <div className="p-2 space-y-4 max-h-80 overflow-y-auto scrollbar-hide">
        <div>
            <div className="text-[9px] uppercase text-gray-500 font-black mb-1.5 px-2 tracking-widest">Overlays</div>
            <div className="grid grid-cols-1 gap-0.5">
                {configs.filter(c => c.type === 'overlay').map(indicator => (
                    <button
                        key={indicator.id}
                        onClick={() => onToggle(indicator.id)}
                        className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all",
                            indicator.enabled 
                                ? "bg-blue-600/10 text-blue-400 font-bold" 
                                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                        )}
                    >
                        <span>{indicator.name}</span>
                        {indicator.enabled && <Check size={12} />}
                    </button>
                ))}
            </div>
        </div>

        <div>
            <div className="text-[9px] uppercase text-gray-500 font-black mb-1.5 px-2 tracking-widest">Oscillators</div>
            <div className="grid grid-cols-1 gap-0.5">
                {configs.filter(c => c.type === 'oscillator').map(indicator => (
                    <button
                        key={indicator.id}
                        onClick={() => onToggle(indicator.id)}
                        className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all",
                            indicator.enabled 
                                ? "bg-blue-600/10 text-blue-400 font-bold" 
                                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                        )}
                    >
                        <span>{indicator.name}</span>
                        {indicator.enabled && <Check size={12} />}
                    </button>
                ))}
            </div>
        </div>
      </div>

      <div className="p-2 border-t border-gray-800 bg-gray-900/30 flex justify-center">
         <button className="flex items-center gap-1.5 text-[9px] font-black uppercase text-gray-500 hover:text-gray-300 transition-colors">
            <Settings2 size={10} />
            Configure Params
         </button>
      </div>
    </div>
  );
}

export default memo(IndicatorPanel);
