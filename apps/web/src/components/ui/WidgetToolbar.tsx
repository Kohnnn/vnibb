'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Maximize2, Minimize2, X, RefreshCw, Sparkles, Move, Info, MoreHorizontal } from 'lucide-react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { WIDGET_DESCRIPTIONS } from '@/lib/widgetDescriptions';
import { isTradingViewWidget } from '@/lib/tradingViewWidgets';
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
  compactParameters?: React.ReactNode;
  actions?: React.ReactNode;
  healthChip?: React.ReactNode;
  highlightSettings?: boolean;
}

export function WidgetToolbar({
  title,
  widgetType,
  symbol,
  onSymbolChange,
  isMaximized = false,
  onMaximize,
  onClose,
  onRefresh,
  onSettings,
  onCopilot,
  showSymbolSelector = false,
  showGroupSelector = false,
  isEditing = false,
  groupSelector,
  tickerSelector,
  compactParameters,
  parameters,
  actions,
  healthChip,
  highlightSettings = false,
}: WidgetToolbarProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const compactPanelRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 8 });
  const requiredWidth = useRef(0);
  const panelId = useId();
  const description = widgetType ? WIDGET_DESCRIPTIONS[widgetType] : undefined;
  const shouldHighlightSettings = Boolean(onSettings && (highlightSettings || isTradingViewWidget(widgetType)));

  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const width = header.getBoundingClientRect().width;
      if (!width) return;
      if (!isCompact) {
        requiredWidth.current = Math.ceil((leadingRef.current?.scrollWidth ?? 0) +
          (trailingRef.current?.scrollWidth ?? 0) + 24);
      }
      setIsCompact(width < requiredWidth.current);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (leadingRef.current) observer.observe(leadingRef.current);
    if (trailingRef.current) observer.observe(trailingRef.current);
    measure();
    return () => observer.disconnect();
  }, [isCompact, title, parameters, actions, groupSelector, tickerSelector]);

  useEffect(() => {
    if (!isCompact) setIsPanelOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (!isPanelOpen) return;
    const positionPanel = () => {
      const rect = compactTriggerRef.current?.getBoundingClientRect();
      if (rect) setPanelPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - (compactPanelRef.current?.offsetHeight ?? 0) - 8)), right: Math.max(8, window.innerWidth - rect.right) });
    };
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-dropdown-menu-content]')) return;
      if (!compactPanelRef.current?.contains(target) && !compactTriggerRef.current?.contains(target)) {
        setIsPanelOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-dropdown-menu-content]')) {
        event.stopPropagation();
        setIsPanelOpen(false);
        compactTriggerRef.current?.focus();
      }
    };
    positionPanel();
    document.addEventListener('click', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    compactPanelRef.current?.querySelector<HTMLElement>('button, select')?.focus();
    return () => {
      document.removeEventListener('click', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [isPanelOpen]);

  const group = showGroupSelector && groupSelector;
  const ticker = showSymbolSelector && (tickerSelector || (symbol && (
    <button type="button" onClick={() => onSymbolChange?.(symbol)} className="rounded px-1 text-xs font-bold text-[var(--accent-blue)]" aria-label={`Select ticker ${symbol}`}>{symbol}</button>
  )));

  const guide = description && (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={() => captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
          action: 'open_guide', widget_type: widgetType, widget_title: title, symbol,
        })} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" aria-label={`About ${title}`}>
          <Info size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="left" className="z-[120] mt-2 w-[min(28rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-modal)] p-3 text-left shadow-2xl">
        <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        {(['purpose', 'calculation', 'interpretation'] as const).map(key => (
          <div key={key} className="mb-2 text-xs text-[var(--text-secondary)]"><strong className="capitalize">{key}: </strong>{description[key]}</div>
        ))}
        {(['advanced_insights', 'limitations', 'pro_tips'] as const).map(key => description[key]?.length ? (
          <div key={key} className="mb-2 text-xs text-[var(--text-secondary)]"><strong>{key.replace('_', ' ')}: </strong>{description[key]?.join(' · ')}</div>
        ) : null)}
      </PopoverContent>
    </Popover>
  );

  const controlClass = 'rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]';
  const command = (label: string, handler: () => void, icon: React.ReactNode) => (
    <button type="button" onClick={() => { setIsPanelOpen(false); handler(); }} title={label} aria-label={label} className={controlClass}>{icon}</button>
  );
  const refresh = onRefresh && command('Refresh widget', onRefresh, <RefreshCw size={12} />);
  const agent = onCopilot && command('Open VniAgent', onCopilot, <Sparkles size={12} />);
  const settings = onSettings && (
    <button type="button" onClick={() => { setIsPanelOpen(false); onSettings(); }} data-tour="widget-settings-trigger" title={shouldHighlightSettings ? 'TradingView settings' : 'Settings'} aria-label="Widget settings" className={shouldHighlightSettings ? `${controlClass} border border-blue-500/30 bg-blue-500/12 text-blue-300` : controlClass}>
      <Settings size={12} />
    </button>
  );
  const maximize = onMaximize && command(isMaximized ? 'Minimize widget' : 'Maximize widget', onMaximize, isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />);
  const close = onClose && command('Close widget', onClose, <X size={12} />);

  return (
    <div ref={headerRef} className="relative flex min-h-9 min-w-0 shrink-0 items-center justify-between gap-1 border-b border-[var(--border-default)] bg-[var(--bg-widget-header)]/80 px-2 select-none">
      <div ref={leadingRef} className={`flex items-center gap-1.5 ${isCompact ? 'min-w-0' : 'shrink-0'}`}>
        {!isCompact && group}
        {!isCompact && ticker}
        <span className={`${isCompact ? 'min-w-0' : 'shrink-0'} max-w-[160px] truncate text-[11px] font-medium text-[var(--text-secondary)]`} title={title} aria-label={title}>{title}</span>
        {!isCompact && guide}
        {!isCompact && parameters && <div className="ml-1 flex items-center gap-1">{parameters}</div>}
      </div>
      <div ref={trailingRef} className="flex shrink-0 items-center gap-1">
        {!isCompact && healthChip}
        {isEditing && <div className="widget-drag-handle cursor-grab p-1 text-[var(--text-muted)] active:cursor-grabbing" aria-label="Drag widget" title="Drag widget"><Move size={12} /></div>}
        {!isCompact && refresh}
        {!isCompact && agent}
        {!isCompact && settings}
        {maximize}
        {!isCompact && close}
        {!isCompact && actions}
        {isCompact && <button ref={compactTriggerRef} type="button" aria-label={`More controls for ${title}`} aria-expanded={isPanelOpen} aria-controls={isPanelOpen ? panelId : undefined} onClick={() => setIsPanelOpen(open => !open)} className={controlClass}><MoreHorizontal size={16} /></button>}
      </div>
      {isCompact && isPanelOpen && typeof document !== 'undefined' && createPortal(
        <div ref={compactPanelRef} id={panelId} role="dialog" aria-label={`${title} controls`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} style={{ top: panelPosition.top, right: panelPosition.right }} className="fixed z-[120] max-h-[min(70vh,32rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)] p-3 text-[var(--text-primary)] shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2"><span className="truncate text-xs font-semibold" title={title}>{title}</span><button type="button" aria-label="Close widget controls" onClick={() => { setIsPanelOpen(false); compactTriggerRef.current?.focus(); }}><X size={14} /></button></div>
          <div className="flex flex-wrap items-center gap-2">{group}{ticker}{guide}{healthChip}</div>
          {(compactParameters || parameters) && <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2">{compactParameters || parameters}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2">{refresh}{agent}{settings}{close}{actions}</div>
        </div>, document.body
      )}
    </div>
  );
}
