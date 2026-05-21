'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
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
  /**
   * Optional native fallback rendered if the TradingView embed fails to
   * mount within the timeout window. Used by widgets like the Screener
   * and the (TV) Stock Heatmap that have an in-house equivalent we can
   * swap to so the user never sees a permanent blank panel. (B3, B9, B10
   * from the QA evaluation report.)
   */
  fallback?: React.ReactNode;
}

const webComponentLoaders = new Map<string, Promise<void>>();
const SCRIPT_LOAD_TIMEOUT_MS = 12000;
const IFRAME_WIDGET_TIMEOUT_MS = 10000;
const WEB_COMPONENT_READY_DELAY_MS = 600;
// Web-component widgets render an internal iframe asynchronously *after*
// the custom element is attached. We poll for that iframe (or any
// rendered child of the shadow root) up to this budget; if none appears
// the embed is treated as a load failure so we can fall back instead of
// leaving the panel spinning forever (B3 Screener, B10 Crypto Market).
const WEB_COMPONENT_RENDER_TIMEOUT_MS = 12000;
const WEB_COMPONENT_POLL_INTERVAL_MS = 250;

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
    let timeoutId: number | null = null;

    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    if (existingScript?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const handleLoad = () => {
      cleanup();
      script.dataset.loaded = 'true';
      resolve();
    };

    const handleError = () => {
      cleanup();
      webComponentLoaders.delete(src);
      reject(new Error(`Failed to load TradingView module: ${src}`));
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      webComponentLoaders.delete(src);
      reject(new Error(`Timed out loading TradingView module: ${src}`));
    }, SCRIPT_LOAD_TIMEOUT_MS);

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
  fallback,
}: TradingViewNativeWidgetProps) {
  const metadata = getTradingViewWidgetMetadata(widgetType);
  const hostRef = useRef<HTMLDivElement>(null);
  const hasTrackedLoadRef = useRef(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Defer iframe-script injection until the host element is at least
  // partially in the viewport. TradingView's iframe widgets each fetch a
  // separate `embed-widget-*.js`, and on dashboards with many such widgets
  // those script loads serialize over the network. Letting the browser
  // discover them on scroll keeps the dashboard responsive and removes the
  // 6+ second Bitcoin-spinner stall users see for the Crypto Coins Heatmap
  // when the surrounding workspace has many TV widgets. (BUG-016)
  const [isInView, setIsInView] = useState(false);
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

  // IntersectionObserver guard. Once visible we never re-arm — the mount
  // effect handles its own teardown on unmount.
  useEffect(() => {
    if (isInView) return;
    const host = hostRef.current;
    if (!host) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(host);

    // Safety net: if the observer never fires (e.g. inside an offscreen
    // tab that nobody scrolls to in 8s), still mount so the user isn't
    // stuck on the skeleton when they switch back.
    const safetyTimer = window.setTimeout(() => setIsInView(true), 8000);

    return () => {
      observer.disconnect();
      window.clearTimeout(safetyTimer);
    };
  }, [isInView]);

  useEffect(() => {
    if (!isInView) return;
    const host = hostRef.current;
    if (!host || !metadata) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    host.innerHTML = '';
    setLoadError(null);
    setIsLoading(true);
    hasTrackedLoadRef.current = false;

    const teardown = () => {
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };

    const stopLoading = () => {
      if (!cancelled) {
        if (!hasTrackedLoadRef.current) {
          hasTrackedLoadRef.current = true;
          captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLoaded, {
            widget_id: id,
            widget_type: widgetType,
            widget_title: metadata.name,
            symbol: resolvedSymbol,
          });
        }
        setIsLoading(false);
      }
    };

    if (metadata.format === 'iframe') {
      const widgetNode = document.createElement('div');
      widgetNode.className = 'tradingview-widget-container__widget';
      widgetNode.style.width = '100%';
      widgetNode.style.height = '100%';

      const frameObserver = new MutationObserver(() => {
        if (host.querySelector('iframe')) {
          frameObserver.disconnect();
          stopLoading();
        }
      });
      frameObserver.observe(host, { childList: true, subtree: true });

      const fallbackTimer = window.setTimeout(() => {
        frameObserver.disconnect();
        if (!cancelled && !host.querySelector('iframe')) {
          captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLoadFailed, {
            widget_id: id,
            widget_type: widgetType,
            widget_title: metadata.name,
            symbol: resolvedSymbol,
            error_type: 'iframe_widget_timeout',
          });
          setLoadError(new Error(`${metadata.name} timed out while loading. TradingView may be blocked or temporarily unavailable.`));
          setIsLoading(false);
        }
      }, IFRAME_WIDGET_TIMEOUT_MS);

      const script = document.createElement('script');
      script.async = true;
      script.type = 'text/javascript';
      script.src = metadata.scriptSrc;
      script.innerHTML = JSON.stringify(runtimeConfig);
      script.addEventListener('error', () => {
        if (!cancelled) {
          captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLoadFailed, {
            widget_id: id,
            widget_type: widgetType,
            widget_title: metadata.name,
            symbol: resolvedSymbol,
            error_type: 'iframe_script_load_failed',
          });
          setLoadError(new Error(`Failed to load ${metadata.name}`));
          setIsLoading(false);
        }
      }, { once: true });

      host.appendChild(widgetNode);
      host.appendChild(script);

      return () => {
        cancelled = true;
        frameObserver.disconnect();
        window.clearTimeout(fallbackTimer);
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

        // Verify the embed actually rendered. The script load resolving
        // is necessary but not sufficient — TradingView still has to
        // attach an iframe (or custom shadow DOM children) inside the
        // host element. Without this poll, B3 (Screener) and B10
        // (Crypto Market) silently spin forever when TradingView blocks
        // the embed (CSP, regional restriction, ad-blocker, etc.). We
        // poll for any iframe / shadow-root content for up to
        // WEB_COMPONENT_RENDER_TIMEOUT_MS; if nothing renders, surface
        // a typed load error so the wrapper can show a fallback or
        // retry button.
        const renderStart = Date.now();

        const isRendered = (host: HTMLElement): boolean => {
          // Treat the embed as rendered only when it has produced an
          // iframe that actually has non-zero dimensions, OR when its web
          // component has populated its shadow DOM with non-empty
          // content. Without this stricter check the placeholder DOM
          // children that TradingView injects (skeleton bars, loaders)
          // pass the original "any direct child" test, which left
          // panels like Cryptocurrency Market spinning forever
          // (QA-v2 G6).
          const iframe = host.querySelector('iframe');
          if (iframe) {
            const rect = iframe.getBoundingClientRect();
            if (rect.height > 0 && rect.width > 0) return true;
            return false;
          }

          const directChild = host.firstElementChild;
          if (
            directChild &&
            metadata.componentTag &&
            directChild.tagName.toLowerCase() === metadata.componentTag &&
            directChild.shadowRoot
          ) {
            const shadowChildren = directChild.shadowRoot.childElementCount;
            if (shadowChildren === 0) return false;
            // Look for any rendered iframe or content node inside the
            // shadow root with a positive bounding box.
            const shadowIframe = directChild.shadowRoot.querySelector('iframe');
            if (shadowIframe) {
              const rect = shadowIframe.getBoundingClientRect();
              if (rect.height > 0 && rect.width > 0) return true;
              return false;
            }
            const childRect = (directChild as HTMLElement).getBoundingClientRect();
            return childRect.height > 32;
          }
          return false;
        };

        const pollForRender = () => {
          if (cancelled) return;
          const host = hostRef.current;
          if (!host) return;

          if (isRendered(host)) {
            stopLoading();
            return;
          }

          const elapsed = Date.now() - renderStart;
          if (elapsed >= WEB_COMPONENT_RENDER_TIMEOUT_MS) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLoadFailed, {
              widget_id: id,
              widget_type: widgetType,
              widget_title: metadata.name,
              symbol: resolvedSymbol,
              error_type: 'web_component_render_timeout',
            });
            setLoadError(
              new Error(
                `${metadata.name} could not render. TradingView may be blocked or temporarily unavailable.`,
              ),
            );
            setIsLoading(false);
            return;
          }

          window.setTimeout(pollForRender, WEB_COMPONENT_POLL_INTERVAL_MS);
        };

        // Give the embed a tiny grace period before the first probe so
        // we don't fight TradingView's own first paint.
        window.setTimeout(pollForRender, WEB_COMPONENT_READY_DELAY_MS);
      } catch (error) {
        if (!cancelled) {
          captureAnalyticsEvent(ANALYTICS_EVENTS.widgetLoadFailed, {
            widget_id: id,
            widget_type: widgetType,
            widget_title: metadata.name,
            symbol: resolvedSymbol,
            error_type: error instanceof Error ? error.message : 'web_component_load_failed',
          });
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
  }, [isInView, metadata, runtimeConfig, webComponentAttributes]);

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
    if (fallback) {
      return <>{fallback}</>;
    }
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
      <div className="relative h-full min-h-[180px] bg-[var(--bg-primary)]">
        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-center gap-3 bg-[var(--bg-primary)]/92">
            <WidgetSkeleton variant="chart" />
            <div className="flex items-center justify-center gap-2 px-4 pb-4 text-[11px] font-medium text-[var(--text-muted)]">
              <RefreshCw size={12} className="animate-spin" />
              <span>Loading {metadata.name}…</span>
            </div>
          </div>
        ) : null}
        <div ref={hostRef} className="tradingview-widget-container h-full w-full" />
      </div>
    </WidgetContainer>
  );
}

function createTradingViewWrapper(
  widgetType: TradingViewNativeWidgetType,
  options?: { fallback?: (props: Omit<TradingViewNativeWidgetProps, 'widgetType' | 'fallback'>) => React.ReactNode },
) {
  return function TradingViewWidgetWrapper(props: Omit<TradingViewNativeWidgetProps, 'widgetType' | 'fallback'>) {
    return (
      <TradingViewNativeWidget
        {...props}
        widgetType={widgetType}
        fallback={options?.fallback ? options.fallback(props) : undefined}
      />
    );
  };
}

// Native fallbacks for TradingView widgets that have an in-house equivalent.
// When the TradingView embed times out or is blocked (CSP, ad-blocker,
// regional restriction), the wrapper renders these instead so the user
// never sees a permanent blank panel. (Phase 1 native fallback per
// `docs/qa-v1.0.0-evaluation-remediation.md`.)
//
// We use next/dynamic so the native fallback bundles aren't pulled into
// the TV widget chunk unless the fallback actually needs to render. The
// extra `as ComponentType<...>` casts side-step React 19 vs next/dynamic
// generic mismatches that surface only on memo-wrapped exports.
const NativeMarketHeatmapFallback = dynamic(
  async () => {
    const mod = await import('./MarketHeatmapWidget');
    return mod.MarketHeatmapWidget as unknown as React.ComponentType<{ id: string; onRemove?: () => void }>;
  },
  { ssr: false },
);

const NativeScreenerFallback = dynamic(
  async () => {
    const mod = await import('./ScreenerWidget');
    return mod.ScreenerWidget as unknown as React.ComponentType<{ id: string; onClose?: () => void }>;
  },
  { ssr: false },
);

const NativeCryptoMarketFallback = dynamic(
  async () => {
    const mod = await import('./CryptoMarketFallback');
    return mod.CryptoMarketFallback as unknown as React.ComponentType<{ id: string; onRemove?: () => void }>;
  },
  { ssr: false },
);

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
export const TradingViewStockHeatmapWidget = createTradingViewWrapper('tradingview_stock_heatmap', {
  fallback: ({ id, onRemove }) => <NativeMarketHeatmapFallback id={id} onRemove={onRemove} />,
});
export const TradingViewCryptoHeatmapWidget = createTradingViewWrapper('tradingview_crypto_heatmap');
export const TradingViewForexCrossRatesWidget = createTradingViewWrapper('tradingview_forex_cross_rates');
export const TradingViewEtfHeatmapWidget = createTradingViewWrapper('tradingview_etf_heatmap');
export const TradingViewForexHeatmapWidget = createTradingViewWrapper('tradingview_forex_heatmap');
export const TradingViewScreenerWidget = createTradingViewWrapper('tradingview_screener', {
  fallback: ({ id, onRemove }) => <NativeScreenerFallback id={id} onClose={onRemove} />,
});
export const TradingViewCryptoMarketWidget = createTradingViewWrapper('tradingview_crypto_market', {
  fallback: ({ id, onRemove }) => <NativeCryptoMarketFallback id={id} onRemove={onRemove} />,
});
export const TradingViewSymbolInfoWidget = createTradingViewWrapper('tradingview_symbol_info');
export const TradingViewTechnicalAnalysisWidget = createTradingViewWrapper('tradingview_technical_analysis');
export const TradingViewFundamentalDataWidget = createTradingViewWrapper('tradingview_fundamental_data');
export const TradingViewCompanyProfileWidget = createTradingViewWrapper('tradingview_company_profile');
export const TradingViewTopStoriesWidget = createTradingViewWrapper('tradingview_top_stories');
export const TradingViewEconomicCalendarWidget = createTradingViewWrapper('tradingview_economic_calendar');
export const TradingViewEconomicMapWidget = createTradingViewWrapper('tradingview_economic_map');
