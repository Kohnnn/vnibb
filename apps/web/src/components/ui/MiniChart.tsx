'use client';

import { useEffect, useMemo, useRef } from 'react';
import { toTradingViewSymbol } from '@/lib/tradingView';

interface MiniChartProps {
  symbol: string;
  exchange?: string;
  width?: number | string;
  height?: number;
}

const SCRIPT_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';

export function MiniChart({ symbol, exchange, width = '100%', height = 40 }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = useMemo(() => toTradingViewSymbol(symbol, exchange), [symbol, exchange]);

  useEffect(() => {
    if (!containerRef.current || !tvSymbol) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol,
      width: '100%',
      height: '100%',
      locale: 'en',
      dateRange: '1M',
      colorTheme: 'dark',
      isTransparent: true,
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [tvSymbol]);

  if (!symbol) {
    return <div className="h-[40px] w-full bg-gray-900/20 rounded animate-pulse" />;
  }

  return (
    <div style={{ width, height }}>
      <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}

export default MiniChart;
