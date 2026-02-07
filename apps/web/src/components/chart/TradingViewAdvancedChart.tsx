'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const TRADINGVIEW_SRC = 'https://s3.tradingview.com/tv.js';

declare global {
  interface Window {
    TradingView?: { widget: new (options: Record<string, unknown>) => { remove?: () => void } };
    __vnibbTradingViewPromise?: Promise<void>;
  }
}

function loadTradingViewScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.TradingView) return Promise.resolve();
  if (!window.__vnibbTradingViewPromise) {
    window.__vnibbTradingViewPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TRADINGVIEW_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load TradingView script'));
      document.head.appendChild(script);
    });
  }
  return window.__vnibbTradingViewPromise;
}

interface TradingViewAdvancedChartProps {
  symbol: string;
  interval?: string;
  timezone?: string;
  theme?: 'light' | 'dark';
  className?: string;
}

export function TradingViewAdvancedChart({
  symbol,
  interval = 'D',
  timezone = 'Asia/Ho_Chi_Minh',
  theme = 'dark',
  className,
}: TradingViewAdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<{ remove?: () => void } | null>(null);
  const containerIdRef = useRef(`tv-adv-${Math.random().toString(36).slice(2, 10)}`);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    setLoadError(null);

    loadTradingViewScript()
      .then(() => {
        if (!isActive || !containerRef.current || !window.TradingView) return;
        if (widgetRef.current?.remove) {
          try {
            widgetRef.current.remove();
          } catch {
            // ignore cleanup race
          }
        }
        containerRef.current.innerHTML = '';

        widgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone,
          theme,
          style: '1',
          locale: 'en',
          toolbar_bg: '#0b0b0b',
          enable_publishing: false,
          allow_symbol_change: false,
          hide_side_toolbar: false,
          withdateranges: true,
          container_id: containerIdRef.current,
        });
      })
      .catch((error) => {
        if (isActive) setLoadError(error.message || 'Failed to load TradingView');
      });

    return () => {
      isActive = false;
      if (widgetRef.current?.remove && containerRef.current) {
        try {
          widgetRef.current.remove();
        } catch {
          // ignore cleanup race
        }
      }
      widgetRef.current = null;
    };
  }, [symbol, interval, timezone, theme]);

  return (
    <div className={cn('relative h-full w-full', className)}>
      <div id={containerIdRef.current} ref={containerRef} className="h-full w-full" />
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 bg-black/50">
          {loadError}
        </div>
      )}
    </div>
  );
}

export default TradingViewAdvancedChart;
