'use client';

import React from 'react';
import { RefreshCw, Maximize2, Settings, X, Loader2, MoreHorizontal, Link, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';

interface WidgetHeaderProps {
  title: string;
  symbol?: string;
  subtitle?: string;
  onRefresh?: () => void;
  onExpand?: () => void;
  onSettings?: () => void;
  onClose?: () => void;
  isLoading?: boolean;
  className?: string;
  actions?: React.ReactNode;
  widgetId?: string;
  showLinkToggle?: boolean;
}

export function WidgetHeader({
  title,
  symbol,
  subtitle,
  onRefresh,
  onExpand,
  onSettings,
  onClose,
  isLoading = false,
  className = '',
  actions,
  widgetId,
  showLinkToggle = false,
}: WidgetHeaderProps) {
  return (
    <div className={cn(
      "flex items-center justify-between px-3 py-2",
      "border-b border-gray-700/50 bg-gray-800/30",
      "shrink-0",
      className
    )}>
      {/* Left: Title & Symbol */}
      <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
        <h3 className="text-sm font-medium text-white truncate">{title}</h3>
        {symbol && (
          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded font-mono">
            {symbol}
          </span>
        )}
        {subtitle && (
          <span className="text-xs text-gray-500 truncate hidden sm:inline">
            {subtitle}
          </span>
        )}
      </div>

      {/* Right: Actions & Controls */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Symbol Link Toggle */}
        {showLinkToggle && widgetId && (
          <LinkToggleButton widgetId={widgetId} />
        )}

        {/* Custom actions slot */}
        {actions}
        
        {/* Separator if actions exist */}
        {(actions || (showLinkToggle && widgetId)) && (onRefresh || onExpand || onSettings || onClose) && (
          <div className="w-px h-4 bg-gray-700 mx-1" />
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="p-1.5">
            <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
          </div>
        )}
        
        {/* Refresh */}
        {onRefresh && !isLoading && (
          <button
            onClick={onRefresh}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Expand */}
        {onExpand && (
          <button
            onClick={onExpand}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Expand"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Settings */}
        {onSettings && (
          <button
            onClick={onSettings}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Close */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700/50 rounded transition-colors"
            title="Remove widget"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function LinkToggleButton({ widgetId }: { widgetId: string }) {
  const { isWidgetLinked, toggleWidgetLink } = useSymbolLink();
  const isLinked = isWidgetLinked(widgetId);

  return (
    <button
      onClick={() => toggleWidgetLink(widgetId)}
      className={cn(
        "p-1.5 rounded transition-colors",
        isLinked 
          ? "text-blue-400 bg-blue-500/20 hover:bg-blue-500/30" 
          : "text-gray-500 hover:text-gray-300 hover:bg-white/10"
      )}
      title={isLinked ? 'Unlink from global symbol' : 'Link to global symbol'}
    >
      {isLinked ? <Link className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
    </button>
  );
}

export default WidgetHeader;
