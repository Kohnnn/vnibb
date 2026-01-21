'use client';

import React from 'react';
import { Settings, Maximize2, Minimize2, Download, X, RefreshCw, Sparkles, Move, Users } from 'lucide-react';

interface WidgetToolbarProps {
  title: string;
  symbol?: string;
  onSymbolChange?: (symbol: string) => void;
  period?: string;
  onPeriodChange?: (period: string) => void;
  isMaximized?: boolean;
  onMaximize?: () => void;
  onExport?: (format: 'csv' | 'json' | 'png') => void;
  onClose?: () => void;
  onRefresh?: () => void;
  onSettings?: () => void;
  onCopilot?: () => void;
  showPeriodToggle?: boolean;
  showSymbolSelector?: boolean;
  showGroupSelector?: boolean;
  
  // Slots for complex components
  groupSelector?: React.ReactNode;
  tickerSelector?: React.ReactNode;
  parameters?: React.ReactNode;
  actions?: React.ReactNode;
}

export function WidgetToolbar({
  title,
  symbol,
  onSymbolChange,
  isMaximized = false,
  onMaximize,
  onExport,
  onClose,
  onRefresh,
  onSettings,
  onCopilot,
  showSymbolSelector = false,
  showGroupSelector = false,
  groupSelector,
  tickerSelector,
  parameters,
  actions,
}: WidgetToolbarProps) {
  return (
    <div className="flex items-center justify-between h-9 px-2 border-b border-gray-700/50 bg-gray-900/50 select-none">
      {/* Left: Sync, Symbol, Title, Parameters */}
      <div className="flex items-center gap-2 min-w-0">
        {showGroupSelector && groupSelector}

        {showSymbolSelector && (tickerSelector || (symbol && (
          <button
            onClick={() => onSymbolChange?.(symbol)}
            className="text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-white/5 px-1 py-0.5 rounded transition-colors"
          >
            {symbol}
          </button>
        )))}

        {showSymbolSelector && <div className="h-3 w-[1px] bg-gray-700" />}

        <span className="text-[11px] font-medium text-gray-400 truncate max-w-[120px]" title={title}>
          {title}
        </span>

        {parameters && (
          <div className="flex items-center gap-1 ml-1">
            <div className="h-3 w-[1px] bg-gray-700 mr-1" />
            {parameters}
          </div>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-1">
        <div className="widget-drag-handle p-1 text-gray-600 hover:text-gray-300 cursor-grab active:cursor-grabbing">
          <Move size={12} />
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        )}

        {onCopilot && (
          <button
            onClick={onCopilot}
            className="p-1 text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
            title="AI Copilot"
          >
            <Sparkles size={12} />
          </button>
        )}

        {onSettings && (
          <button
            onClick={onSettings}
            className="p-1 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded transition-colors"
            title="Settings"
          >
            <Settings size={12} />
          </button>
        )}

        {onMaximize && (
          <button
            onClick={onMaximize}
            className="p-1 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded transition-colors"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        )}
        
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Close"
          >
            <X size={12} />
          </button>
        )}

        {actions}
      </div>
    </div>
  );
}
