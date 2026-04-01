'use client';

import { useEffect, useMemo, useRef } from 'react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useProfile } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';

interface TradingViewTechnicalAnalysisWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';

export function TradingViewTechnicalAnalysisWidget({
  id,
  symbol,
  onRemove,
}: TradingViewTechnicalAnalysisWidgetProps) {
  const shouldResolveProfile = Boolean(symbol) && !symbol.includes(':');
  const { data: profileData, isFetching, dataUpdatedAt } = useProfile(symbol, shouldResolveProfile);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolvedSymbol = useMemo(
    () => toTradingViewSymbol(symbol, profileData?.data?.exchange),
    [profileData?.data?.exchange, symbol],
  );

  useEffect(() => {
    if (!containerRef.current || !resolvedSymbol) return;

    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      interval: '1D',
      width: '100%',
      isTransparent: true,
      height: '100%',
      symbol: resolvedSymbol,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: 'en',
      colorTheme: 'dark',
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [resolvedSymbol]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view TradingView technicals" />;
  }

  return (
    <WidgetContainer
      title="TradingView Technicals"
      symbol={symbol}
      widgetId={id}
      onClose={onRemove}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching}
            note="TradingView technical gauge"
            align="right"
          />
        </div>
        <div className="flex-1 min-h-[340px]">
          <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TradingViewTechnicalAnalysisWidget;
