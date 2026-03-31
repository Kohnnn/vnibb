'use client';

import { useEffect, useRef } from 'react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface TradingViewTickerTapeWidgetProps {
  id: string;
  symbol?: string;
  onRemove?: () => void;
}

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';

const TICKER_TAPE_SYMBOLS = [
  { description: 'VCI', proName: 'HOSE:VCI' },
  { description: 'VNM', proName: 'HOSE:VNM' },
  { description: 'FPT', proName: 'HOSE:FPT' },
  { description: 'TCB', proName: 'HOSE:TCB' },
  { description: 'S&P 500', proName: 'SP:SPX' },
  { description: 'Nasdaq 100', proName: 'NASDAQ:QQQ' },
  { description: 'USD/VND', proName: 'FX:USDVND' },
  { description: 'Bitcoin', proName: 'BINANCE:BTCUSDT' },
  { description: 'Gold', proName: 'TVC:GOLD' },
  { description: 'WTI Oil', proName: 'TVC:USOIL' },
] as const;

const TICKER_TAPE_GROUPS = ['VN Core', 'Global Macro', 'FX', 'Crypto'] as const;

export function TradingViewTickerTapeWidget({ id, onRemove }: TradingViewTickerTapeWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      symbols: TICKER_TAPE_SYMBOLS,
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: 'adaptive',
      colorTheme: 'dark',
      locale: 'en',
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <WidgetContainer title="TradingView Ticker Tape" widgetId={id} onClose={onRemove} noPadding>
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta
            note="VN-first tape with global macro symbols via TradingView"
            sourceLabel="TradingView ticker tape"
            align="right"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {TICKER_TAPE_GROUPS.map((group) => (
              <span
                key={group}
                className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
              >
                {group}
              </span>
            ))}
          </div>
        </div>
        <div
          className="flex-1 min-h-[92px] px-2 py-2"
          style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.08), transparent)' }}
        >
          <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TradingViewTickerTapeWidget;
