'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildTradingViewSymbolCandidates,
  persistResolvedTradingViewSymbol
} from '@/lib/tradingView';

const TRADINGVIEW_WIDGET_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const WIDGET_LOAD_TIMEOUT_MS = 8000;

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
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  const candidates = useMemo(
    () => buildTradingViewSymbolCandidates(symbol, exchange),
    [symbol, exchange]
  );
  const tvSymbol = candidates[candidateIndex] || '';
  const tradingViewUrl = tvSymbol
    ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`
    : 'https://www.tradingview.com/';

  useEffect(() => {
    setCandidateIndex(0);
    setStatus(candidates.length > 0 ? 'loading' : 'idle');
  }, [candidates]);

  useEffect(() => {
    if (!containerRef.current || !tvSymbol) return;

    containerRef.current.innerHTML = '';
    setStatus('loading');

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
    let disposed = false;
    let resolved = false;

    const markReady = () => {
      if (disposed) return;
      resolved = true;
      setStatus('ready');
      persistResolvedTradingViewSymbol(symbol, tvSymbol);
    };

    const hasIframe = () => !!containerRef.current?.querySelector('iframe');

    const observer = new MutationObserver(() => {
      if (hasIframe()) {
        observer.disconnect();
        markReady();
      }
    });
    observer.observe(containerRef.current, { childList: true, subtree: true });

    const pollId = window.setInterval(() => {
      if (hasIframe()) {
        window.clearInterval(pollId);
        observer.disconnect();
        markReady();
      }
    }, 250);

    const timeoutId = window.setTimeout(() => {
      if (disposed || resolved) return;
      observer.disconnect();
      window.clearInterval(pollId);

      if (candidateIndex < candidates.length - 1) {
        setCandidateIndex((current) => current + 1);
        return;
      }
      setStatus('failed');
    }, WIDGET_LOAD_TIMEOUT_MS);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [tvSymbol, interval, timezone, theme, allowSymbolChange, candidates.length, candidateIndex, symbol]);

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
      {status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 p-4 text-center text-[11px] text-gray-300">
          {status === 'failed' ? (
            <>
              <div>TradingView embed failed for this symbol.</div>
              <div className="text-[10px] text-gray-400">
                Tried: {candidates.join(', ')}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCandidateIndex(0);
                    setStatus('loading');
                  }}
                  className="inline-flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-[10px] text-gray-200 hover:border-gray-400"
                >
                  <RefreshCw size={10} />
                  Retry
                </button>
                <a
                  href={tradingViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-blue-500/50 px-2 py-1 text-[10px] text-blue-200 hover:border-blue-300"
                >
                  <ExternalLink size={10} />
                  Open in TradingView
                </a>
              </div>
            </>
          ) : (
            <>
              <div>Loading TradingView chart...</div>
              <div className="text-[10px] text-gray-400">Trying: {tvSymbol}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TradingViewAdvancedChart;
