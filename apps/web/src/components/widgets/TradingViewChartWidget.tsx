'use client';

import { useEffect, useMemo, useRef } from 'react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useProfile } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';

interface TradingViewChartWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function TradingViewChartWidget({ id, symbol, onRemove }: TradingViewChartWidgetProps) {
  const shouldResolveProfile = Boolean(symbol) && !symbol.includes(':');
  const { data: profileData, isFetching, dataUpdatedAt } = useProfile(symbol, shouldResolveProfile);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolvedSymbol = useMemo(
    () => toTradingViewSymbol(symbol, profileData?.data?.exchange),
    [profileData?.data?.exchange, symbol],
  );
  const exchangeLabel = resolvedSymbol.includes(':')
    ? resolvedSymbol.split(':')[0]
    : profileData?.data?.exchange;

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
      studies: ['Volume@tv-basicstudies'],
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
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching}
            note={exchangeLabel ? `${exchangeLabel.toUpperCase()} TradingView chart` : 'TradingView advanced chart'}
            align="right"
          />
        </div>
        <div className="flex-1 min-h-[320px]">
          <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TradingViewChartWidget;
