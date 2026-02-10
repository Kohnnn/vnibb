'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { toTradingViewSymbol } from '@/lib/tradingView';

const TRADINGVIEW_WIDGET_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

interface TradingViewAdvancedChartProps {
  symbol: string;
  exchange?: string;
  interval?: string;
  timezone?: string;
  theme?: 'light' | 'dark';
  className?: string;
  height?: number;
  allowSymbolChange?: boolean;
}

function resolveTradingViewSymbol(symbol: string, exchange?: string): string {
  const trimmed = symbol?.trim();
  if (!trimmed) return '';

  if (exchange) {
    const mapped = toTradingViewSymbol(trimmed, exchange);
    if (mapped) return mapped;
  }

  if (/^[A-Z]{3,4}$/.test(trimmed.toUpperCase())) {
    return `HOSE:${trimmed.toUpperCase()}`;
  }

  return trimmed.toUpperCase();
}

export function TradingViewAdvancedChart({
  symbol,
  exchange,
  interval = 'D',
  timezone = 'Asia/Ho_Chi_Minh',
  theme = 'dark',
  className,
  height = 400,
  allowSymbolChange = true,
}: TradingViewAdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = useMemo(() => resolveTradingViewSymbol(symbol, exchange), [symbol, exchange]);

  useEffect(() => {
    if (!containerRef.current || !tvSymbol) return;

    containerRef.current.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container__widget';
    wrapper.style.height = '100%';
    wrapper.style.width = '100%';

    const script = document.createElement('script');
    script.src = TRADINGVIEW_WIDGET_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone,
      theme,
      style: '1',
      locale: 'vi_VN',
      allow_symbol_change: allowSymbolChange,
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });

    containerRef.current.appendChild(wrapper);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [tvSymbol, interval, timezone, theme, allowSymbolChange]);

  if (!tvSymbol) {
    return (
      <div className={cn('flex items-center justify-center text-xs text-gray-500', className)}>
        Select a symbol to load TradingView
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('tradingview-widget-container relative h-full w-full', className)}
      style={{ minHeight: height }}
    >
      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500">
        Loading TradingView Chart...
      </div>
    </div>
  );
}

export default TradingViewAdvancedChart;
