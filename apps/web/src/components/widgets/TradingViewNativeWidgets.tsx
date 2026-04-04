'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { toTradingViewSymbol } from '@/lib/tradingView';
import {
  buildTradingViewRuntimeConfig,
  buildTradingViewWebComponentAttributes,
  getTradingViewWidgetMetadata,
  type TradingViewNativeWidgetType,
} from '@/lib/tradingViewWidgets';
import type { WidgetConfig } from '@/types/dashboard';
import type { WidgetGroupId } from '@/types/widget';

interface TradingViewNativeWidgetProps {
  id: string;
  symbol?: string;
  config?: WidgetConfig;
  onRemove?: () => void;
  widgetGroup?: WidgetGroupId;
  widgetType: TradingViewNativeWidgetType;
}

const webComponentLoaders = new Map<string, Promise<void>>();

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function loadTradingViewWebComponentModule(src: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  const cached = webComponentLoaders.get(src);
  if (cached) {
    return cached;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-tv-widget-src="${src}"]`);
    const script = existingScript ?? document.createElement('script');

    if (existingScript?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const handleLoad = () => {
      script.dataset.loaded = 'true';
      resolve();
    };

    const handleError = () => {
      webComponentLoaders.delete(src);
      reject(new Error(`Failed to load TradingView module: ${src}`));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.type = 'module';
      script.async = true;
      script.src = src;
      script.dataset.tvWidgetSrc = src;
      document.head.appendChild(script);
    }
  });

  webComponentLoaders.set(src, promise);
  return promise;
}

function TradingViewNativeWidget({
  id,
  symbol,
  config,
  onRemove,
  widgetType,
}: TradingViewNativeWidgetProps) {
  const metadata = getTradingViewWidgetMetadata(widgetType);
  const hostRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const allowsOverflow = widgetType === 'tradingview_ticker_tag';

  const resolvedSymbol = useMemo(() => {
    if (!symbol) return '';
    return toTradingViewSymbol(symbol);
  }, [symbol]);

  const runtimeConfig = useMemo(
    () => buildTradingViewRuntimeConfig(widgetType, config, resolvedSymbol),
    [config, resolvedSymbol, widgetType],
  );

  const webComponentAttributes = useMemo(
    () => buildTradingViewWebComponentAttributes(widgetType, config, resolvedSymbol),
    [config, resolvedSymbol, widgetType],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !metadata) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    host.innerHTML = '';
    setLoadError(null);
    setIsLoading(true);

    const teardown = () => {
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };

    if (metadata.format === 'iframe') {
      const widgetNode = document.createElement('div');
      widgetNode.className = 'tradingview-widget-container__widget';
      widgetNode.style.width = '100%';
      widgetNode.style.height = '100%';

      const script = document.createElement('script');
      script.async = true;
      script.type = 'text/javascript';
      script.src = metadata.scriptSrc;
      script.innerHTML = JSON.stringify(runtimeConfig);
      script.addEventListener('error', () => {
        if (!cancelled) {
          setLoadError(new Error(`Failed to load ${metadata.name}`));
          setIsLoading(false);
        }
      }, { once: true });
      script.addEventListener('load', () => {
        if (!cancelled) {
          setIsLoading(false);
        }
      }, { once: true });

      host.appendChild(widgetNode);
      host.appendChild(script);

      return () => {
        cancelled = true;
        teardown();
      };
    }

    const mountWebComponent = async () => {
      try {
        await loadTradingViewWebComponentModule(metadata.scriptSrc);
        if (cancelled || !hostRef.current || !metadata.componentTag) return;

        const element = document.createElement(metadata.componentTag);
        element.setAttribute('style', 'display:block;width:100%;height:100%;');

        Object.entries(webComponentAttributes).forEach(([key, value]) => {
          element.setAttribute(toKebabCase(key), value);
        });

        hostRef.current.innerHTML = '';
        hostRef.current.appendChild(element);
        setIsLoading(false);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error as Error);
          setIsLoading(false);
        }
      }
    };

    void mountWebComponent();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [metadata, runtimeConfig, webComponentAttributes]);

  if (!metadata) {
    return <WidgetError error={new Error(`Unknown TradingView widget: ${widgetType}`)} />;
  }

  if (
    metadata.symbolMode === 'widget' &&
    widgetType !== 'tradingview_top_stories' &&
    !runtimeConfig.symbol
  ) {
    return <WidgetEmpty message={`Set a symbol to load ${metadata.name}.`} />;
  }

  if (loadError) {
    return <WidgetError error={loadError} />;
  }

  return (
    <WidgetContainer
      title={metadata.name}
      widgetId={id}
      onClose={onRemove}
      isLoading={isLoading}
      noPadding
      className={allowsOverflow ? 'overflow-visible' : undefined}
      bodyClassName={allowsOverflow ? 'overflow-visible' : undefined}
    >
      <div className="h-full min-h-[180px] bg-[var(--bg-primary)]">
        <div ref={hostRef} className="tradingview-widget-container h-full w-full" />
      </div>
    </WidgetContainer>
  );
}

function createTradingViewWrapper(widgetType: TradingViewNativeWidgetType) {
  return function TradingViewWidgetWrapper(props: Omit<TradingViewNativeWidgetProps, 'widgetType'>) {
    return <TradingViewNativeWidget {...props} widgetType={widgetType} />;
  };
}

export const TradingViewChartWidget = createTradingViewWrapper('tradingview_chart');
export const TradingViewSymbolOverviewWidget = createTradingViewWrapper('tradingview_symbol_overview');
export const TradingViewMiniChartWidget = createTradingViewWrapper('tradingview_mini_chart');
export const TradingViewMarketSummaryWidget = createTradingViewWrapper('tradingview_market_summary');
export const TradingViewMarketOverviewWidget = createTradingViewWrapper('tradingview_market_overview');
export const TradingViewStockMarketWidget = createTradingViewWrapper('tradingview_stock_market');
export const TradingViewMarketDataWidget = createTradingViewWrapper('tradingview_market_data');
export const TradingViewTickerTapeWidget = createTradingViewWrapper('tradingview_ticker_tape');
export const TradingViewTickerTagWidget = createTradingViewWrapper('tradingview_ticker_tag');
export const TradingViewSingleTickerWidget = createTradingViewWrapper('tradingview_single_ticker');
export const TradingViewTickerWidget = createTradingViewWrapper('tradingview_ticker');
export const TradingViewStockHeatmapWidget = createTradingViewWrapper('tradingview_stock_heatmap');
export const TradingViewCryptoHeatmapWidget = createTradingViewWrapper('tradingview_crypto_heatmap');
export const TradingViewForexCrossRatesWidget = createTradingViewWrapper('tradingview_forex_cross_rates');
export const TradingViewEtfHeatmapWidget = createTradingViewWrapper('tradingview_etf_heatmap');
export const TradingViewForexHeatmapWidget = createTradingViewWrapper('tradingview_forex_heatmap');
export const TradingViewScreenerWidget = createTradingViewWrapper('tradingview_screener');
export const TradingViewCryptoMarketWidget = createTradingViewWrapper('tradingview_crypto_market');
export const TradingViewSymbolInfoWidget = createTradingViewWrapper('tradingview_symbol_info');
export const TradingViewTechnicalAnalysisWidget = createTradingViewWrapper('tradingview_technical_analysis');
export const TradingViewFundamentalDataWidget = createTradingViewWrapper('tradingview_fundamental_data');
export const TradingViewCompanyProfileWidget = createTradingViewWrapper('tradingview_company_profile');
export const TradingViewTopStoriesWidget = createTradingViewWrapper('tradingview_top_stories');
export const TradingViewEconomicCalendarWidget = createTradingViewWrapper('tradingview_economic_calendar');
export const TradingViewEconomicMapWidget = createTradingViewWrapper('tradingview_economic_map');
