'use client';

import React from 'react';
import { Settings, Maximize2, Minimize2, Download, X, RefreshCw, Sparkles, Move, Users, Info } from 'lucide-react';
import { WIDGET_DESCRIPTIONS } from '@/lib/widgetDescriptions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { WidgetType } from '@/types/dashboard';

interface WidgetToolbarProps {
  title: string;
  widgetType?: WidgetType;
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
  isEditing?: boolean;
  
  // Slots for complex components
  groupSelector?: React.ReactNode;
  tickerSelector?: React.ReactNode;
  parameters?: React.ReactNode;
  actions?: React.ReactNode;
}

export function WidgetToolbar({
  title,
  widgetType,
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
  isEditing = false,
  groupSelector,
  tickerSelector,
  parameters,
  actions,
}: WidgetToolbarProps) {
  const description = widgetType ? WIDGET_DESCRIPTIONS[widgetType] : undefined;

  return (
    <div className="flex h-8 items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-widget-header)]/80 px-2 select-none">
      {/* Left: Sync, Symbol, Title, Parameters */}
      <div className="flex items-center gap-2 min-w-0">
        {showGroupSelector && groupSelector}

        {showSymbolSelector && (tickerSelector || (symbol && (
          <button
            onClick={() => onSymbolChange?.(symbol)}
            className="text-xs font-bold text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] px-1 py-0.5 rounded transition-colors"
          >
            {symbol}
          </button>
        )))}

        {showSymbolSelector && <div className="h-3 w-[1px] bg-[var(--border-subtle)]" />}

        <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate max-w-[120px]" title={title}>
          {title}
        </span>

        {description && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                title="Widget guide"
                aria-label={`About ${title}`}
              >
                <Info size={12} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="left"
              className="z-[120] mt-2 w-[28rem] rounded-xl border border-[var(--border-default)] bg-[rgba(10,15,26,0.98)] p-3 text-left shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Widget Guide</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{title}</div>
                </div>
                <div className="text-[10px] text-slate-300/70">Click outside or press Esc to close</div>
              </div>
              <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1 text-[11px] leading-5 text-slate-100">
                <div>
                  <div className="mb-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Purpose</div>
                  <p className="text-slate-100/90">{description.purpose}</p>
                </div>
                <div>
                  <div className="mb-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Calculation</div>
                  <p className="text-slate-100/82">{description.calculation}</p>
                </div>
                <div>
                  <div className="mb-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Interpretation</div>
                  <p className="text-slate-100/82">{description.interpretation}</p>
                </div>
                {description.advanced_insights?.length ? (
                  <div>
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/80">Advanced Insights</div>
                    <div className="space-y-1.5 text-slate-100/84">
                      {description.advanced_insights.map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {description.limitations?.length ? (
                  <div>
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200/85">Limitations</div>
                    <div className="space-y-1.5 text-slate-100/78">
                      {description.limitations.map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {description.pro_tips?.length ? (
                  <div>
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200/85">Pro Tips</div>
                    <div className="space-y-1.5 text-slate-100/82">
                      {description.pro_tips.map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {parameters && (
          <div className="flex items-center gap-1 ml-1">
            <div className="h-3 w-[1px] bg-[var(--border-subtle)] mr-1" />
            {parameters}
          </div>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-1">
        {isEditing && (
          <div className="widget-drag-handle p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing">
            <Move size={12} />
          </div>
        )}

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        )}

        {onCopilot && (
          <button
            onClick={onCopilot}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-blue-500/10 rounded transition-colors"
            title="AI Copilot"
          >
            <Sparkles size={12} />
          </button>
        )}

        {onSettings && (
          <button
            onClick={onSettings}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title="Settings"
          >
            <Settings size={12} />
          </button>
        )}

        {onMaximize && (
          <button
            onClick={onMaximize}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        )}
        
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
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
