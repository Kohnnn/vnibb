'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import { buildChartEventMarkers, type ChartEventMarker } from '@/lib/chartEventMarkers';
import { cn } from '@/lib/utils';

export type AdvancedChartMode = 'candles' | 'line' | 'area';
export type AdvancedChartTimeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'YTD';

interface TradingViewAdvancedChartProps {
  symbol: string;
  timeframe: AdvancedChartTimeframe;
  mode?: AdvancedChartMode;
  className?: string;
  height?: number;
}

interface ChartPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const REQUEST_TIMEOUT_MS = 20000;

function toDateInput(value: Date): string {
  return value.toISOString().split('T')[0];
}

function resolveDateRange(timeframe: AdvancedChartTimeframe): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);

  switch (timeframe) {
    case '1D':
      start.setDate(end.getDate() - 2);
      break;
    case '5D':
      start.setDate(end.getDate() - 7);
      break;
    case '1M':
      start.setDate(end.getDate() - 31);
      break;
    case '3M':
      start.setDate(end.getDate() - 93);
      break;
    case '6M':
      start.setDate(end.getDate() - 186);
      break;
    case '1Y':
      start.setDate(end.getDate() - 365);
      break;
    case '3Y':
      start.setDate(end.getDate() - 365 * 3);
      break;
    case '5Y':
      start.setDate(end.getDate() - 365 * 5);
      break;
    case 'YTD':
      start.setMonth(0, 1);
      break;
  }

  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function normalizePoints(rows: Array<Record<string, unknown>>): ChartPoint[] {
  return rows
    .map((row) => ({
      time: String(row.time ?? ''),
      open: Number(row.open ?? 0),
      high: Number(row.high ?? 0),
      low: Number(row.low ?? 0),
      close: Number(row.close ?? 0),
      volume: Number(row.volume ?? 0),
    }))
    .filter(
      (row) =>
        row.time &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close)
    )
    .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
}

function mergeQuote(points: ChartPoint[], quote: Awaited<ReturnType<typeof getQuote>>['data'] | null): ChartPoint[] {
  if (!quote?.price || !quote.updatedAt || points.length === 0) {
    return points;
  }

  const quoteTime = new Date(quote.updatedAt);
  if (Number.isNaN(quoteTime.getTime())) {
    return points;
  }

  const next = [...points];
  const latest = next[next.length - 1];
  const latestTime = new Date(latest.time);
  const quoteDay = new Date(quoteTime.getFullYear(), quoteTime.getMonth(), quoteTime.getDate()).getTime();
  const latestDay = new Date(latestTime.getFullYear(), latestTime.getMonth(), latestTime.getDate()).getTime();

  const mergedPoint: ChartPoint = {
    time: quoteTime.toISOString(),
    open: Number(quote.open ?? latest.close ?? quote.price),
    high: Number(quote.high ?? Math.max(latest.high, Number(quote.price))),
    low: Number(quote.low ?? Math.min(latest.low, Number(quote.price))),
    close: Number(quote.price),
    volume: Number(quote.volume ?? latest.volume ?? 0),
  };

  if (quoteDay === latestDay) {
    next[next.length - 1] = mergedPoint;
    return next;
  }

  if (quoteDay < latestDay) {
    return next;
  }

  next.push(mergedPoint);
  return next;
}

export function TradingViewAdvancedChart({
  symbol,
  timeframe,
  mode = 'candles',
  className,
  height = 220,
}: TradingViewAdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [eventMarkers, setEventMarkers] = useState<ChartEventMarker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<'raw' | 'adjusted'>('adjusted');

  const dateRange = useMemo(() => resolveDateRange(timeframe), [timeframe]);

  useEffect(() => {
    if (!symbol) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [historyResponse, quoteResponse, eventsResponse] = await Promise.all([
          getHistoricalPrices(symbol, {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            interval: '1D',
            adjustmentMode,
            signal: controller.signal,
          }),
          getQuote(symbol, controller.signal).catch(() => null),
          getCompanyEvents(symbol, { limit: 80 }).catch(() => null),
        ]);

        const normalized = normalizePoints((historyResponse?.data || []) as unknown as Array<Record<string, unknown>>);
        const merged = mergeQuote(normalized, quoteResponse?.data ?? null);
        setPoints(merged);
        setEventMarkers(buildChartEventMarkers(eventsResponse?.data || [], merged, timeframe === '5Y' ? 12 : 8));
      } catch (fetchError) {
        if ((fetchError as Error)?.name === 'AbortError') {
          return;
        }
        setError((fetchError as Error)?.message || 'Failed to load chart data');
        setPoints([]);
        setEventMarkers([]);
      } finally {
        window.clearTimeout(timeoutId);
        setIsLoading(false);
      }
    };

    load();

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [adjustmentMode, symbol, timeframe, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const removeChart = (chart: IChartApi | null) => {
      if (!chart) return;
      try {
        chart.remove();
      } catch {
        // Ignore disposal races.
      }
    };

    const renderChart = async () => {
      const { createChart, ColorType, CrosshairMode } = await import('lightweight-charts');
      if (disposed || !containerRef.current) return;

      const initialWidth = containerRef.current.clientWidth;
      const initialHeight = containerRef.current.clientHeight;
      if (initialWidth <= 0 || initialHeight <= 0) {
        window.requestAnimationFrame(() => {
          if (!disposed) {
            renderChart();
          }
        });
        return;
      }

      removeChart(chartRef.current);
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;

      const cssVars = getComputedStyle(document.documentElement);
      const bgPrimary = cssVars.getPropertyValue('--bg-primary').trim() || '#0b1220';
      const bgSecondary = cssVars.getPropertyValue('--bg-secondary').trim() || '#111827';
      const textMuted = cssVars.getPropertyValue('--text-muted').trim() || '#94a3b8';
      const borderColor = cssVars.getPropertyValue('--border-color').trim() || '#334155';
      const borderSubtle = cssVars.getPropertyValue('--border-subtle').trim() || '#1f2937';

      const chart = createChart(containerRef.current, {
        width: initialWidth,
        height: initialHeight,
        layout: {
          background: { type: ColorType.Solid, color: bgPrimary },
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
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        timeScale: {
          borderColor,
          timeVisible: timeframe !== '5Y',
          rightOffset: 4,
        },
        handleScroll: { vertTouchDrag: false },
      });

      if (disposed) {
        removeChart(chart);
        return;
      }

      chartRef.current = chart;

      let series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'>;
      if (mode === 'line') {
        series = chart.addLineSeries({
          color: '#38bdf8',
          lineWidth: 2,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        });
        series.setData(points.map((point) => ({ time: point.time, value: point.close })));
      } else if (mode === 'area') {
        series = chart.addAreaSeries({
          topColor: 'rgba(56, 189, 248, 0.35)',
          bottomColor: 'rgba(56, 189, 248, 0.04)',
          lineColor: '#38bdf8',
          lineWidth: 2,
        });
        series.setData(points.map((point) => ({ time: point.time, value: point.close })));
      } else {
        series = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
        series.setData(
          points.map((point) => ({
            time: point.time,
            open: point.open,
            high: point.high,
            low: point.low,
            close: point.close,
          }))
        );
      }
      mainSeriesRef.current = series;
      series.setMarkers(
        eventMarkers.map((marker) => ({
          time: marker.date,
          position: marker.position,
          color: marker.color,
          shape: marker.shape,
          text: marker.shortLabel,
        }))
      );

      const volumeSeries = chart.addHistogramSeries({
        color: '#475569',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(
        points.map((point) => ({
          time: point.time,
          value: point.volume,
          color: point.close >= point.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
        }))
      );
      volumeSeriesRef.current = volumeSeries;

      chart.timeScale().fitContent();

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || disposed || chartRef.current !== chart) return;
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;
        chart.applyOptions({ width, height });
      });
      resizeObserver.observe(containerRef.current);
    };

    renderChart();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      removeChart(chartRef.current);
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [eventMarkers, mode, points, timeframe]);

  return (
    <div className={cn('relative h-full w-full', className)} style={{ minHeight: height }}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 p-1 backdrop-blur">
        {(['adjusted', 'raw'] as const).map((modeOption) => (
          <button
            key={modeOption}
            type="button"
            onClick={() => setAdjustmentMode(modeOption)}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
              adjustmentMode === modeOption
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
          >
            {modeOption}
          </button>
        ))}
      </div>

      {eventMarkers.length > 0 ? (
        <div className="pointer-events-none absolute bottom-7 left-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 px-2 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur">
          <span>D dividend</span>
          <span>•</span>
          <span>S split</span>
          <span>•</span>
          <span>R rights</span>
        </div>
      ) : null}

      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)' }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-modal)] px-4 py-3 text-xs text-[var(--text-secondary)] shadow-xl">
            <RefreshCw size={14} className="animate-spin text-sky-400" />
            <span>Loading live chart data...</span>
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 82%, transparent)' }}
        >
          <div className="max-w-sm rounded-xl border border-red-500/25 bg-[var(--bg-modal)] px-4 py-3 text-center text-xs text-[var(--text-secondary)] shadow-xl">
            <div className="mb-1 font-semibold text-[var(--text-primary)]">Chart data unavailable</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {!isLoading && !error && points.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 82%, transparent)' }}
        >
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-modal)] px-4 py-3 text-xs text-[var(--text-secondary)] shadow-xl">
            No chart data available for this range.
          </div>
        </div>
      )}
    </div>
  );
}

export default TradingViewAdvancedChart;
