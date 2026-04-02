'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useProfile } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';
import { useDashboard } from '@/contexts/DashboardContext';
import { cn } from '@/lib/utils';

interface TradingViewChartWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

const PRESET_SYMBOLS = [
  { label: 'QQQ', symbol: 'NASDAQ:QQQ', tone: 'text-cyan-300' },
  { label: 'SPY', symbol: 'AMEX:SPY', tone: 'text-sky-300' },
  { label: 'DXY', symbol: 'TVC:DXY', tone: 'text-emerald-300' },
  { label: 'BTC', symbol: 'BINANCE:BTCUSDT', tone: 'text-amber-300' },
  { label: 'USD/VND', symbol: 'FX:USDVND', tone: 'text-lime-300' },
  { label: 'Gold', symbol: 'TVC:GOLD', tone: 'text-yellow-300' },
] as const;

export function TradingViewChartWidget({ id, symbol, onRemove }: TradingViewChartWidgetProps) {
  const shouldResolveProfile = Boolean(symbol) && !symbol.includes(':');
  const { state, activeDashboard, activeTab, updateWidget } = useDashboard();
  const { data: profileData, isFetching, dataUpdatedAt } = useProfile(symbol, shouldResolveProfile);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolvedSymbol = useMemo(
    () => toTradingViewSymbol(symbol, profileData?.data?.exchange),
    [profileData?.data?.exchange, symbol],
  );
  const exchangeLabel = resolvedSymbol.includes(':')
    ? resolvedSymbol.split(':')[0]
    : profileData?.data?.exchange;
  const widgetLocation = useMemo(() => {
    for (const dashboard of state.dashboards) {
      for (const tab of dashboard.tabs) {
        if (tab.widgets.some((widget) => widget.id === id)) {
          return { dashboardId: dashboard.id, tabId: tab.id };
        }
      }
    }

    if (activeDashboard && activeTab) {
      return { dashboardId: activeDashboard.id, tabId: activeTab.id };
    }

    return null;
  }, [activeDashboard, activeTab, id, state.dashboards]);

  const handlePresetSelect = useCallback((nextSymbol: string) => {
    if (!widgetLocation) return;
    updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
      config: { symbol: nextSymbol },
      type: 'tradingview_chart',
    });
  }, [id, updateWidget, widgetLocation]);

  useEffect(() => {
    if (!containerRef.current || !resolvedSymbol) return;

    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: resolvedSymbol,
      interval: 'D',
      timezone: 'Asia/Ho_Chi_Minh',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_top_toolbar: false,
      hide_legend: false,
      withdateranges: true,
      backgroundColor: 'rgba(15, 23, 42, 1)',
      gridColor: 'rgba(148, 163, 184, 0.08)',
      watchlist: [],
      details: false,
      hotlist: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [resolvedSymbol]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view TradingView" />;
  }

  return (
    <WidgetContainer
      title="TradingView Chart"
      symbol={symbol}
      widgetId={id}
      onClose={onRemove}
      noPadding
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching}
            note={exchangeLabel ? `${exchangeLabel.toUpperCase()} TradingView chart` : 'TradingView advanced chart'}
            align="right"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Quick markets
            </span>
            {PRESET_SYMBOLS.map((preset) => {
              const active = resolvedSymbol === preset.symbol;
              return (
                <button
                  key={preset.symbol}
                  type="button"
                  onClick={() => handlePresetSelect(preset.symbol)}
                  className={cn(
                    'rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors',
                    active
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                      : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                  )}
                >
                  <span className={cn('mr-1', preset.tone)}>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 min-h-[320px]">
          <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TradingViewChartWidget;
