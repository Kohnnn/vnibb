'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import { buildChartEventMarkers, type ChartEventMarker } from '@/lib/chartEventMarkers';
import { cn } from '@/lib/utils';

export type AdvancedChartMode = 'candles' | 'line' | 'area';
export type AdvancedChartTimeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'MAX' | 'YTD';

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
const MIN_CHART_DIMENSION_PX = 8;
const MAX_CHART_SIZE_RETRIES = 90;

function getSafeChartSize(element: HTMLElement | null): { width: number; height: number } | null {
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= MIN_CHART_DIMENSION_PX ||
    height <= MIN_CHART_DIMENSION_PX
  ) {
    return null;
  }

  return { width, height };
}

function isChartDimensionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return normalized.includes('width') && normalized.includes('height') && normalized.includes('greater than 0');
}

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
    case 'MAX':
      // MAX = 10 years rather than year-2000. Vietnam tickers usually have
      // ~5–10 years of liquid daily bars; opening the range to 2000-01-01
      // produced ~6500 bars at ~0.1 px each, which made candles invisible
      // (QA-v2 CC1/T1). Volume histograms still rendered because they are
      // solid blocks per pixel column. Capping at 10 years keeps every
      // candle ≥1 px wide on a ~700 px viewport while still showing a
      // long-cycle view.
      start.setFullYear(end.getFullYear() - 10);
      break;
    case 'YTD':
      start.setMonth(0, 1);
      break;
  }

  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoints(rows: Array<Record<string, unknown>>): ChartPoint[] {
  // QA-v4: Aggressive dedup-by-date. Even when the API server returns
  // duplicate rows for the same trading day (mixed raw/adjusted shapes
  // in Mongo, or merged DB+cache results), lightweight-charts paints the
  // second entry on top of the first with conflicting OHLC values which
  // produces invisible candles. We keep the row whose absolute close is
  // SMALLEST per date — that's typically the post-adjustment price that
  // matches the rest of the dashboard's display convention.
  const byDate = new Map<string, ChartPoint>();
  rows
    .map((row) => {
      const time = String(row.time ?? '').slice(0, 10);
      const open = safeNumber(row.open);
      const high = safeNumber(row.high);
      const low = safeNumber(row.low);
      const close = safeNumber(row.close);
      const volume = safeNumber(row.volume) ?? 0;
      if (open === null || high === null || low === null || close === null || !time) {
        return null;
      }
      return { time, open, high, low, close, volume };
    })
    .filter((row): row is ChartPoint => row !== null)
    .forEach((row) => {
      const existing = byDate.get(row.time);
      if (!existing) {
        byDate.set(row.time, row);
        return;
      }
      // Prefer the row whose `close` is smaller — post-adjustment series
      // for VN equities (e.g. VCI 23.22 vs raw 31.56 on 2024-01-02).
      if (row.close < existing.close) {
        byDate.set(row.time, row);
      }
    });
  return Array.from(byDate.values()).sort(
    (left, right) => new Date(left.time).getTime() - new Date(right.time).getTime()
  );
}

/**
 * Format a Date as a `YYYY-MM-DD` business-day string suitable for
 * lightweight-charts. Uses the local calendar day (matches the convention used
 * by the historical-prices API which returns `Pydantic date` → date-only).
 *
 * Mixing a full ISO timestamp with date-only strings inside a single
 * lightweight-charts series silently rejects the data (chart frame still
 * draws but candles disappear). Always emit `YYYY-MM-DD` here so every point
 * in the series is the same time-kind.
 */
function toBusinessDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mergeQuote(points: ChartPoint[], quote: Awaited<ReturnType<typeof getQuote>>['data'] | null): ChartPoint[] {
  if (!quote?.price || !quote.updatedAt || points.length === 0) {
    return points;
  }

  const quoteTime = new Date(quote.updatedAt);
  if (Number.isNaN(quoteTime.getTime())) {
    return points;
  }

  const quotePrice = safeNumber(quote.price);
  if (quotePrice === null) {
    return points;
  }

  const next = [...points];
  const latest = next[next.length - 1];
  const latestTime = new Date(latest.time);
  const quoteDay = new Date(quoteTime.getFullYear(), quoteTime.getMonth(), quoteTime.getDate()).getTime();
  const latestDay = new Date(latestTime.getFullYear(), latestTime.getMonth(), latestTime.getDate()).getTime();

  // For same-day merges, reuse the exact `time` of the historical bar so the
  // string format never drifts. For new-day pushes, build a fresh
  // `YYYY-MM-DD` business-day string from the quote's calendar day.
  const mergedTime = quoteDay === latestDay ? latest.time : toBusinessDayString(quoteTime);

  // Coerce optional quote fields, defaulting safely to the latest historical
  // values (which are guaranteed non-null after normalizePoints). Never
  // allow a null/NaN to land in the merged point.
  const quoteOpen = safeNumber(quote.open) ?? latest.close ?? quotePrice;
  const quoteHigh = safeNumber(quote.high) ?? Math.max(latest.high, quotePrice);
  const quoteLow = safeNumber(quote.low) ?? Math.min(latest.low, quotePrice);
  const quoteVolume = safeNumber(quote.volume) ?? latest.volume ?? 0;

  const mergedPoint: ChartPoint = {
    time: mergedTime,
    open: quoteOpen,
    high: quoteHigh,
    low: quoteLow,
    close: quotePrice,
    volume: quoteVolume,
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
    let retryFrame: number | null = null;
    let retryCount = 0;
    let isRendering = false;

    const removeChart = (chart: IChartApi | null) => {
      if (!chart) return;
      try {
        chart.remove();
      } catch {
        // Ignore disposal races.
      }
    };

    const clearRetryFrame = () => {
      if (retryFrame === null) return;
      window.cancelAnimationFrame(retryFrame);
      retryFrame = null;
    };

    const scheduleRenderRetry = () => {
      if (disposed || retryFrame !== null || retryCount >= MAX_CHART_SIZE_RETRIES) return;

      retryCount += 1;
      retryFrame = window.requestAnimationFrame(() => {
        retryFrame = null;
        if (!disposed) {
          void renderChart();
        }
      });
    };

    const renderChart = async () => {
      if (isRendering) return;

      if (disposed || !containerRef.current) return;

      const initialSize = getSafeChartSize(containerRef.current);
      if (!initialSize) {
        scheduleRenderRetry();
        return;
      }

      isRendering = true;

      try {
        const { createChart, ColorType, CrosshairMode } = await import('lightweight-charts');
        if (disposed || !containerRef.current) return;

        const safeSize = getSafeChartSize(containerRef.current);
        if (!safeSize) {
          scheduleRenderRetry();
          return;
        }

        clearRetryFrame();
        retryCount = 0;

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
          width: safeSize.width,
          height: safeSize.height,
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
            // Enforce a minimum bar spacing so candle bodies stay visible
            // even when the user picks a long timeframe with thousands of
            // bars. Without this, lightweight-charts auto-fits to a
            // sub-pixel bar width and candles render as invisible 0-px
            // strokes (QA-v2 CC1/T1).
            barSpacing: 6,
            minBarSpacing: 2,
          },
          handleScroll: { vertTouchDrag: false },
        });

        if (disposed) {
          removeChart(chart);
          return;
        }

        chartRef.current = chart;

        let series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'>;
        // Final defense-in-depth: lightweight-charts will throw "Value is
        // null" deep inside its candlestick renderer if any OHLC value
        // arrives non-finite. normalizePoints + mergeQuote already guard,
        // but we filter once more here right before setData so any future
        // upstream regression cannot crash the chart.
        const safePoints = points.filter(
          (point) =>
            !!point.time &&
            Number.isFinite(point.open) &&
            Number.isFinite(point.high) &&
            Number.isFinite(point.low) &&
            Number.isFinite(point.close)
        );
        // Diagnostic guard. If lightweight-charts gets zero rows we
        // render an empty axis frame which previously looked identical
        // to the "candles invisible" bug. Surface a typed empty state
        // instead so the user (and QA) can tell them apart.
        if (points.length > 0 && safePoints.length === 0) {
          removeChart(chartRef.current);
          chartRef.current = null;
          mainSeriesRef.current = null;
          volumeSeriesRef.current = null;
          setError('Chart data could not be parsed for this timeframe.');
          return;
        }
        if (mode === 'line') {
          series = chart.addLineSeries({
            color: '#38bdf8',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
          });
          series.setData(safePoints.map((point) => ({ time: point.time, value: point.close })));
        } else if (mode === 'area') {
          series = chart.addAreaSeries({
            topColor: 'rgba(56, 189, 248, 0.35)',
            bottomColor: 'rgba(56, 189, 248, 0.04)',
            lineColor: '#38bdf8',
            lineWidth: 2,
          });
          series.setData(safePoints.map((point) => ({ time: point.time, value: point.close })));
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
            safePoints.map((point) => ({
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
        // Apply scale margins BEFORE setData so the volume histogram does
        // not occupy the full chart height on first paint (which can
        // visually crowd out the candles before the next render frame).
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
        volumeSeries.setData(
          safePoints.map((point) => ({
            time: point.time,
            value: Number.isFinite(point.volume) ? point.volume : 0,
            color: point.close >= point.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
          }))
        );
        volumeSeriesRef.current = volumeSeries;

        // Show the most recent ~120 bars (about 6 trading months) by
        // default. Calling fitContent() with a multi-year dataset
        // compressed candles to sub-pixel widths and made them invisible
        // (QA-v2 CC1/T1). setVisibleLogicalRange keeps the user's
        // chosen timeframe queryable while ensuring candles render at a
        // readable size.
        const visibleBars = Math.min(safePoints.length, 180);
        if (visibleBars > 0) {
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, safePoints.length - visibleBars),
            to: safePoints.length - 1,
          });
        } else {
          chart.timeScale().fitContent();
        }
      } catch (chartError) {
        removeChart(chartRef.current);
        chartRef.current = null;
        mainSeriesRef.current = null;
        volumeSeriesRef.current = null;

        if (isChartDimensionError(chartError)) {
          scheduleRenderRetry();
          return;
        }

        setError((chartError as Error)?.message || 'Failed to render chart');
      } finally {
        isRendering = false;
      }
    };

    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || disposed) return;
      const safeSize = getSafeChartSize(containerRef.current);
      if (!safeSize) return;

      const chart = chartRef.current;
      if (!chart) {
        scheduleRenderRetry();
        return;
      }

      try {
        chart.applyOptions(safeSize);
      } catch (resizeError) {
        if (isChartDimensionError(resizeError)) {
          scheduleRenderRetry();
          return;
        }
        setError((resizeError as Error)?.message || 'Failed to resize chart');
      }
    });
    resizeObserver.observe(containerRef.current);

    void renderChart();

    return () => {
      disposed = true;
      clearRetryFrame();
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
