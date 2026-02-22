'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { getChartData } from '@/lib/api';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

// Period options for the chart
const PERIODS = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'] as const;
type Period = (typeof PERIODS)[number];

// Chart display types
const CHART_TYPES = ['Candlestick', 'Line', 'Area'] as const;
type ChartType = (typeof CHART_TYPES)[number];

interface ChartDataPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceChartLocalWidgetProps {
  id: string;
  symbol?: string;
  onRemove?: () => void;
  isEditing?: boolean;
}

// Session cache for chart data
const chartCache = new Map<string, { data: ChartDataPoint[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(symbol: string, period: string): string {
  return `${symbol}:${period}`;
}

function getCachedData(symbol: string, period: string): ChartDataPoint[] | null {
  const key = getCacheKey(symbol, period);
  const cached = chartCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedData(symbol: string, period: string, data: ChartDataPoint[]): void {
  const key = getCacheKey(symbol, period);
  // Limit cache size
  if (chartCache.size >= 30) {
    const firstKey = chartCache.keys().next().value;
    if (firstKey) chartCache.delete(firstKey);
  }
  chartCache.set(key, { data, timestamp: Date.now() });
}

export function PriceChartLocalWidget({
  id,
  symbol,
  onRemove,
}: PriceChartLocalWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [period, setPeriod] = useState<Period>('10Y');
  const [chartType, setChartType] = useState<ChartType>('Candlestick');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  // Fetch chart data
  const fetchData = useCallback(async (sym: string | undefined, per: Period) => {
    if (!sym) return;

    // Check session cache first
    const cached = getCachedData(sym, per);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await getChartData(sym, per);
      const chartData = response.data || [];
      setData(chartData);
      setCachedData(sym, per, chartData);
      setLastUpdated(Date.now());
    } catch (err: any) {
      console.error('[PriceChartLocal] Fetch error:', err);
      setError(err.message || 'Failed to load chart data');
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch data when symbol or period changes
  useEffect(() => {
    fetchData(symbol, period);
  }, [symbol, period, fetchData]);

  // Create/update chart
  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const loadChart = async () => {
      const { createChart, ColorType: CT, CrosshairMode } = await import('lightweight-charts');

      // Dispose previous chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        mainSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }

      const container = chartContainerRef.current;
      if (!container) return;

      const cssVars = getComputedStyle(document.documentElement);
      const bgPrimary = cssVars.getPropertyValue('--bg-primary').trim() || '#ffffff';
      const bgSecondary = cssVars.getPropertyValue('--bg-secondary').trim() || '#f5f7fa';
      const textMuted = cssVars.getPropertyValue('--text-muted').trim() || '#9ca3af';
      const borderColor = cssVars.getPropertyValue('--border-color').trim() || '#1f2937';
      const borderSubtle = cssVars.getPropertyValue('--border-subtle').trim() || '#374151';

      const chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
          background: { type: CT.Solid, color: bgPrimary },
          textColor: textMuted,
          fontSize: 11,
        },
        grid: {
          vertLines: { color: borderSubtle },
          horzLines: { color: borderSubtle },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: textMuted, width: 1, style: 3, labelBackgroundColor: bgSecondary },
          horzLine: { color: textMuted, width: 1, style: 3, labelBackgroundColor: bgSecondary },
        },
        rightPriceScale: {
          borderColor,
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: {
          borderColor,
          timeVisible: false,
          rightOffset: 5,
        },
        handleScroll: { vertTouchDrag: false },
      });

      chartRef.current = chart;

      // Add main series based on chart type
      let mainSeries: any;

      if (chartType === 'Candlestick') {
        mainSeries = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderDownColor: '#ef4444',
          borderUpColor: '#22c55e',
          wickDownColor: '#ef4444',
          wickUpColor: '#22c55e',
        });
        mainSeries.setData(
          data.map((d) => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );
      } else if (chartType === 'Line') {
        mainSeries = chart.addLineSeries({
          color: '#3b82f6',
          lineWidth: 2,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        });
        mainSeries.setData(
          data.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
      } else {
        // Area
        mainSeries = chart.addAreaSeries({
          topColor: 'rgba(59, 130, 246, 0.4)',
          bottomColor: 'rgba(59, 130, 246, 0.04)',
          lineColor: '#3b82f6',
          lineWidth: 2,
        });
        mainSeries.setData(
          data.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
      }

      mainSeriesRef.current = mainSeries;

      // Add volume histogram
      const volumeSeries = chart.addHistogramSeries({
        color: '#374151',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      volumeSeries.setData(
        data.map((d) => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        }))
      );

      volumeSeriesRef.current = volumeSeries;

      // Fit content
      chart.timeScale().fitContent();

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && chart) {
          const { width, height } = entry.contentRect;
          chart.applyOptions({ width, height });
        }
      });

      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
        chart.remove();
      };
    };

    loadChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, chartType]);

  // Compute price stats for header
  const priceStats = useMemo(() => {
    if (data.length === 0) return null;
    const latest = data[data.length - 1];
    const first = data[0];
    const change = latest.close - first.close;
    const changePct = first.close > 0 ? (change / first.close) * 100 : 0;
    return {
      price: latest.close,
      change,
      changePct,
      high: Math.max(...data.map((d) => d.high)),
      low: Math.min(...data.map((d) => d.low)),
    };
  }, [data]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view chart" />;
  }

  return (
    <WidgetContainer
      title="Price Chart"
      symbol={symbol}
      widgetId={id}
      onClose={onRemove}
      noPadding
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        {/* Header bar */}
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 flex-wrap">
          {/* Price stats */}
          <div className="flex items-center gap-2 min-w-0">
            {priceStats && (
              <>
                <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  {priceStats.price.toLocaleString('vi-VN')}
                </span>
                <span
                  className={`text-xs font-medium tabular-nums ${
                    priceStats.change >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {priceStats.change >= 0 ? '+' : ''}
                  {priceStats.changePct.toFixed(2)}%
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Period selector */}
            <div className="flex gap-0.5 bg-[var(--bg-secondary)] rounded-md p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    period === p
                      ? 'bg-blue-600 text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Chart type selector */}
            <div className="flex gap-0.5 bg-[var(--bg-secondary)] rounded-md p-0.5">
              {CHART_TYPES.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setChartType(ct)}
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    chartType === ct
                      ? 'bg-indigo-600 text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  {ct === 'Candlestick' ? '🕯️' : ct === 'Line' ? '📈' : '📊'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart area */}
        <div className="flex-1 relative min-h-[200px]">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-primary)]/90">
              <WidgetSkeleton />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-primary)]">
              <div className="text-center px-4">
                <p className="text-red-400 text-sm mb-2">⚠️ {error}</p>
                <button
                  onClick={() => fetchData(symbol, period)}
                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* Footer meta */}
        <div className="px-3 py-1 border-t border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={lastUpdated || undefined}
            isFetching={isLoading}
            note={`${data.length} datapoints · ${period}`}
            align="right"
          />
        </div>
      </div>
    </WidgetContainer>
  );
}

export default PriceChartLocalWidget;
