'use client';

import { useEffect, useRef, useState } from 'react';
import type { HistogramData, IChartApi, ISeriesApi, WhitespaceData } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import type { QuoteData } from '@/lib/api';
import { buildChartEventMarkers, type ChartEventMarker } from '@/lib/chartEventMarkers';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { CHART_CAPTURE_EVENT, LIGHT_CAPTURE_ATTR, type ChartLightCaptureDetail } from '@/lib/chartCapture';
import { useColorblind } from '@/lib/colorblind';
import { isObservedVolume } from '@/lib/volumeObservation';
import {
  usePriceHistoryRequest,
  type PriceAdjustmentMode,
  type PriceHistoryControl,
  type PriceHistoryRequest,
  type PriceHistoryStatus,
} from '@/lib/priceChartScope';

export type AdvancedChartMode = 'candles' | 'line' | 'area';
export type AdvancedChartTimeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'MAX' | 'YTD';

interface TradingViewAdvancedChartProps {
  symbol: string;
  compareSymbol?: string;
  timeframe: AdvancedChartTimeframe;
  mode?: AdvancedChartMode;
  className?: string;
  height?: number;
  history?: PriceHistoryControl;
  onHistoryStatusChange?: (status: PriceHistoryStatus) => void;
}

interface ChartPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  priceUnit: 'VND' | 'index_points' | 'unknown';
  observedAt: number | null;
  adjustmentApplied: boolean;
}

const REQUEST_TIMEOUT_MS = 20000;
const HISTORY_UNAVAILABLE = 'Price history could not be loaded. Please try again.';
const MIN_CHART_DIMENSION_PX = 8;
const MAX_CHART_SIZE_RETRIES = 90;

interface ExcludedSession {
  time: string;
}

/** A renderer point: a certified bar, or whitespace marking an excluded session. */
type ChartSeriesPoint = ChartPoint | ExcludedSession;

interface HistoryData {
  points: ChartSeriesPoint[];
  comparePoints: ChartPoint[];
  comparison?: PriceHistoryStatus['comparison'];
  eventMarkers: ChartEventMarker[];
  error: string | null;
  excludedNotice: string | null;
  historyDelivery: { partial: boolean; fallback: boolean } | null;
  sessionBasis: string;
  adjustmentCoverage: number | null;
}

interface HistoryResult extends HistoryData {
  request: PriceHistoryRequest;
}

const EMPTY_HISTORY: HistoryData = {
  points: [], comparePoints: [], eventMarkers: [], error: null, excludedNotice: null,
  historyDelivery: null, sessionBasis: 'Unknown', adjustmentCoverage: null,
};

function isChartPoint(point: ChartSeriesPoint): point is ChartPoint {
  return 'close' in point;
}

/**
 * The single certified unit shared by every marked session, or `null` when no
 * session is marked or marked sessions disagree (VND vs index points cannot
 * share one price axis). Unmarked sessions are tolerated and later excluded —
 * they are never guessed into a unit. The response-level `unit_status` is
 * deliberately unused: deployed payloads reported `confirmed_vnd` alongside
 * mixed-magnitude rows.
 */
function certifiedUnit(points: ChartPoint[]): 'VND' | 'index_points' | null {
  const marked = points.filter((point) => point.priceUnit !== 'unknown');
  if (marked.length === 0) return null;
  const first = marked[0].priceUnit;
  if (first === 'unknown') return null;
  return marked.every((point) => point.priceUnit === first) ? first : null;
}

/**
 * Explicit unavailable reason plus excluded coverage for a series that certifies
 * no single unit. The chart is withheld rather than plotting only the marked
 * subset, which would join the excluded sessions into one line.
 */
function uncertifiedNotice(points: ChartPoint[]): string {
  const unmarked = points.filter((point) => point.priceUnit === 'unknown').length;
  const reason = unmarked === points.length
    ? 'no session carries a price-unit marker'
    : unmarked > 0
      ? `${unmarked} of ${points.length} sessions carry no price-unit marker`
      : 'certified sessions mix VND and index points, which cannot share one price axis';
  return `No certified price series: ${reason}. All ${points.length} sessions excluded from the chart.`;
}

/**
 * Keep excluded sessions in the series as whitespace so the renderer leaves a
 * gap there. Dropping them and joining the certified bars would draw one
 * continuous line across sessions the source never certified.
 */
function withExcludedGaps(points: ChartPoint[], unit: 'VND' | 'index_points'): ChartSeriesPoint[] {
  return points.map((point) => (point.priceUnit === unit ? point : { time: point.time }));
}

/** Degraded disclosure naming the excluded coverage of an otherwise certified series. */
function excludedCoverageNotice(excluded: number, total: number): string {
  return `${excluded} of ${total} sessions excluded: price unit unconfirmed.`;
}

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

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const marketDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});
const observationPattern = /^(\d{4}-\d{2}-\d{2})(?:T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/;

function parseMarketObservation(value: string | null | undefined): { day: string; instant: number | null } | null {
  const match = value?.match(observationPattern);
  if (!match) return null;
  const [, day, clock, offset] = match;
  const dayCheck = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(dayCheck.getTime()) || !dayCheck.toISOString().startsWith(day)) return null;
  // A day-only history row is a session key, not a midnight observation.
  if (!clock) return { day, instant: null };
  // The quote route interprets naive source timestamps as Vietnam wall time.
  const date = new Date(`${day}T${clock}${offset ?? '+07:00'}`);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = marketDate.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return { day: `${part('year')}-${part('month')}-${part('day')}`, instant: date.getTime() };
}

function normalizePoints(rows: Array<Record<string, unknown>>): ChartPoint[] {
  const byDate = new Map<string, ChartPoint>();
  for (const row of rows) {
    const observation = parseMarketObservation(typeof row.time === 'string' ? row.time : null);
    const open = safeNumber(row.open);
    const high = safeNumber(row.high);
    const low = safeNumber(row.low);
    const close = safeNumber(row.close);
    if (open === null || high === null || low === null || close === null || !observation) continue;
    const { day: time, instant: observedAt } = observation;
    // The history endpoint owns source/adjustment precedence; retain its first valid row per day.
    if (byDate.has(time)) continue;
    // The row marker is the only certification source. The response-level
    // `unit_status` cannot fill a missing marker: deployed payloads reported
    // `confirmed_vnd` alongside mixed-magnitude rows.
    const priceUnit = row.price_unit === 'VND' || row.price_unit === 'index_points'
      ? row.price_unit
      : 'unknown';
    byDate.set(time, {
      time, open, high, low, close,
      volume: isObservedVolume(row.volume) ? row.volume : null,
      priceUnit,
      observedAt,
      adjustmentApplied: row.adjustment_applied === true,
    });
  }
  return Array.from(byDate.values()).sort((left, right) => left.time.localeCompare(right.time));
}

function qualifyComparison(
  symbol: string,
  response: Awaited<ReturnType<typeof getHistoricalPrices>> | null,
): Pick<HistoryData, 'comparePoints' | 'comparison'> {
  if (!symbol) return { comparePoints: [] };
  if (!response || response.error != null) {
    return {
      comparePoints: [],
      comparison: { observationStatus: 'unavailable', warning: `${symbol} comparison history could not be loaded.` },
    };
  }
  const points = normalizePoints((response.data || []) as unknown as Array<Record<string, unknown>>);
  if (points.length === 0) {
    return {
      comparePoints: [],
      comparison: { observationStatus: 'empty', warning: `No ${symbol} comparison history is available for this range.` },
    };
  }
  // The rebased series needs one certified unit throughout and a positive starting close.
  const unit = certifiedUnit(points);
  if (unit === null || points.some((point) => point.priceUnit !== unit) || points[0].close <= 0) {
    return {
      comparePoints: [],
      comparison: { observationStatus: 'unavailable', warning: `${symbol} comparison history could not be plotted.` },
    };
  }
  return { comparePoints: points, comparison: { observationStatus: 'available' } };
}

function mergeQuote(points: ChartPoint[], quote: QuoteData | null): ChartPoint[] {
  const priceUnit = quote?.price_unit;
  if (quote?.price == null || points.length === 0 ||
      (priceUnit !== 'VND' && priceUnit !== 'index_points') ||
      points.some((point) => point.priceUnit !== priceUnit)) {
    return points;
  }

  // Only the admitted observation dates the bar; updated_at may be a storage write.
  const observation = parseMarketObservation(quote.as_of);
  const quotePrice = safeNumber(quote.price);
  if (!observation || quotePrice === null) return points;

  const latest = points[points.length - 1];
  const { day: quoteDay, instant } = observation;
  if (quoteDay < latest.time) return points;
  const isSameDay = quoteDay === latest.time;
  // A raw quote cannot replace an adjusted bar or a more recent observation.
  if (isSameDay && (latest.adjustmentApplied ||
      (latest.observedAt !== null && (instant === null || instant < latest.observedAt)))) return points;

  const mergedPoint: ChartPoint = {
    time: isSameDay ? latest.time : quoteDay,
    open: safeNumber(quote.open) ?? (isSameDay ? latest.open : quotePrice),
    high: safeNumber(quote.high) ?? (isSameDay ? Math.max(latest.high, quotePrice) : quotePrice),
    low: safeNumber(quote.low) ?? (isSameDay ? Math.min(latest.low, quotePrice) : quotePrice),
    close: quotePrice,
    volume: isObservedVolume(quote.volume) ? quote.volume : isSameDay ? latest.volume : null,
    priceUnit,
    observedAt: instant,
    adjustmentApplied: false,
  };

  return isSameDay ? [...points.slice(0, -1), mergedPoint] : [...points, mergedPoint];
}

export function TradingViewAdvancedChart({
  symbol,
  compareSymbol,
  timeframe,
  mode = 'candles',
  className,
  height = 220,
  history,
  onHistoryStatusChange,
}: TradingViewAdvancedChartProps) {
  const [standaloneAdjustment, setStandaloneAdjustment] = useState<PriceAdjustmentMode>('adjusted');
  const standaloneRequest = usePriceHistoryRequest({
    symbol, timeframe, compareSymbol: compareSymbol ?? '', adjustmentMode: standaloneAdjustment,
  });
  const request = history?.request ?? standaloneRequest;
  const setAdjustmentMode = history?.setAdjustmentMode ?? setStandaloneAdjustment;
  const { compareSymbol: activeCompareSymbol, adjustmentMode } = request;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();
  // The canvas is a bitmap: it only picks up a colour-vision swap when the
  // chart is rebuilt, so the mode is part of this effect's dependencies.
  const colorblind = useColorblind();
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [result, setResult] = useState<HistoryResult>();
  const [canvasError, setCanvasError] = useState<{ request: PriceHistoryRequest; message: string }>();
  const [hoveredPoint, setHoveredPoint] = useState<ChartPoint | null>(null);
  const currentResult = result?.request === request ? result : undefined;
  const {
    points, comparePoints, comparison, eventMarkers, excludedNotice, historyDelivery, sessionBasis, adjustmentCoverage,
  } = currentResult ?? EMPTY_HISTORY;
  const isLoading = Boolean(request.symbol) && !currentResult;
  const error = currentResult?.error ?? (canvasError?.request === request ? canvasError.message : null);

  useEffect(() => {
    const { symbol, compareSymbol, timeframe, startDate, endDate, interval, adjustmentMode } = request;
    if (!symbol) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const options = { startDate, endDate, interval, adjustmentMode, signal: controller.signal };
    let disposed = false;

    const load = async () => {
      try {
        const [historyResponse, quoteResponse, eventsResponse, compareResponse] = await Promise.all([
          getHistoricalPrices(symbol, options),
          getQuote(symbol, controller.signal).catch(() => null),
          getCompanyEvents(symbol, { limit: 80 }).catch(() => null),
          compareSymbol ? getHistoricalPrices(compareSymbol, options).catch(() => null) : Promise.resolve(null),
        ]);

        if (disposed) return;
        setHoveredPoint(null);
        const historyError = historyResponse?.error != null;
        const delivery = {
          ...EMPTY_HISTORY,
          request,
          sessionBasis: historyResponse?.meta?.session_basis || 'Unknown',
          adjustmentCoverage: historyResponse?.meta?.adjustment_coverage_pct ?? null,
        };
        const normalized = normalizePoints(
          (historyResponse?.data || []) as unknown as Array<Record<string, unknown>>,
        );
        const merged = mergeQuote(normalized, quoteResponse?.data ?? null);
        const unit = certifiedUnit(merged);
        if (merged.length === 0) {
          setResult({ ...delivery, error: historyError ? HISTORY_UNAVAILABLE : null });
          return;
        }
        if (unit === null) {
          // No certified unit covers the response (every row unmarked, or marked
          // rows disagree on VND vs index points), so no honest series can be
          // drawn. Withhold the chart and name the excluded coverage instead of
          // plotting the marked subset as if it were continuous certified history.
          setResult({ ...delivery, error: uncertifiedNotice(merged) });
          return;
        }

        const excluded = merged.filter((point) => point.priceUnit !== unit).length;
        const partial = historyError || historyResponse?.meta?.completeness_status === 'partial';
        const fallback = historyResponse?.meta?.fallback_used === true;
        setResult({
          ...delivery,
          // Unmarked sessions keep their slot as whitespace so the renderer breaks
          // the line there instead of joining across them.
          points: withExcludedGaps(merged, unit),
          ...qualifyComparison(compareSymbol, compareResponse),
          eventMarkers: buildChartEventMarkers(eventsResponse?.data || [], merged, timeframe === '5Y' ? 12 : 8),
          excludedNotice: excluded > 0 ? excludedCoverageNotice(excluded, merged.length) : null,
          historyDelivery: partial || fallback ? { partial, fallback } : null,
        });
      } catch {
        if (!disposed) setResult({ ...EMPTY_HISTORY, request, error: HISTORY_UNAVAILABLE });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void load();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [request]);

  const observationStatus = error ? 'unavailable' : points.length ? 'available' : 'empty';
  const coverage = observationStatus === 'available' && (historyDelivery?.partial || excludedNotice || comparison?.warning)
    ? 'partial' : undefined;
  useEffect(() => {
    if (!isLoading) onHistoryStatusChange?.({ request, observationStatus, coverage, comparison });
  }, [request, isLoading, observationStatus, coverage, comparison, onHistoryStatusChange]);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let retryFrame: number | null = null;
    let retryCount = 0;
    let isRendering = false;
    let removeCaptureListener: (() => void) | null = null;

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
        // Direction colors come from the semantic tokens so colorblind mode +
        // light/dark overrides reach the candlesticks and volume bars. (DEF-001)
        const upColor = cssVars.getPropertyValue('--color-positive').trim() || '#22c55e';
        const downColor = cssVars.getPropertyValue('--color-negative').trim() || '#ef4444';
        // Series colours: brand blue is focal, Slate is comparison. Reading the
        // tokens keeps light theme and color-vision mode in sync with the palette
        // instead of pinning a fixed hue that reads as a state colour.
        const focalColor = cssVars.getPropertyValue('--chart-blue').trim() || '#3b82f6';
        const compareColor = cssVars.getPropertyValue('--chart-slate').trim() || '#5B6573';
        // Marker colours are theme-dependent tokens, and lightweight-charts
        // writes colours straight into the canvas, where `var(...)` is invalid.
        // Resolve them against a given cascade (live root or light capture).
        const resolveMarkerColor = (marker: ChartEventMarker, read: (name: string) => string): string => {
          if (!marker.color.startsWith('var(')) return marker.color;
          const token = marker.color.slice(4, -1);
          return read(token).trim() || (marker.category === 'dividend' ? '#f59e0b' : marker.category === 'split' ? '#a78bfa' : '#22d3ee');
        };
        const liveMarkerColor = (marker: ChartEventMarker) => resolveMarkerColor(marker, (n) => cssVars.getPropertyValue(n));
        const hexToRgba = (hex: string, alpha: number): string => {
          const h = hex.replace('#', '').trim();
          if (h.length !== 6) return `rgba(148,163,184,${alpha})`;
          const r = parseInt(h.slice(0, 2), 16);
          const g = parseInt(h.slice(2, 4), 16);
          const b = parseInt(h.slice(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

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
        //
        // `points` may also carry whitespace entries for sessions excluded for
        // an unconfirmed unit. They are kept in every series so the renderer
        // draws a gap there rather than one continuous line across them.
        const isRenderablePoint = (point: ChartSeriesPoint): point is ChartPoint =>
          isChartPoint(point) &&
          !!point.time &&
          Number.isFinite(point.open) &&
          Number.isFinite(point.high) &&
          Number.isFinite(point.low) &&
          Number.isFinite(point.close);
        const safePoints = points.filter(isRenderablePoint);
        const safeComparePoints = comparePoints.filter(
          (point) =>
            !!point.time &&
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
          setCanvasError({ request, message: 'Chart data could not be parsed for this timeframe.' });
          return;
        }
        const effectiveMode = request.timeframe === 'MAX' && safePoints.length > 900 && mode === 'candles' ? 'line' : mode;
        try {
          if (effectiveMode === 'line') {
            series = chart.addLineSeries({
              color: focalColor,
              lineWidth: 2,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 4,
            });
            series.setData(points.map((point) => (
              isRenderablePoint(point) ? { time: point.time, value: point.close } : { time: point.time }
            )));
          } else if (effectiveMode === 'area') {
            series = chart.addAreaSeries({
              topColor: hexToRgba(focalColor, 0.35),
              bottomColor: hexToRgba(focalColor, 0.04),
              lineColor: focalColor,
              lineWidth: 2,
            });
            series.setData(points.map((point) => (
              isRenderablePoint(point) ? { time: point.time, value: point.close } : { time: point.time }
            )));
          } else {
            series = chart.addCandlestickSeries({
              upColor: upColor,
              downColor: downColor,
              borderUpColor: upColor,
              borderDownColor: downColor,
              wickUpColor: upColor,
              wickDownColor: downColor,
            });
            series.setData(
              points.map((point) => (
                isRenderablePoint(point)
                  ? { time: point.time, open: point.open, high: point.high, low: point.low, close: point.close }
                  : { time: point.time }
              ))
            );
          }
        } catch (setDataError) {
          // QA-v3 F4/T1: lightweight-charts silently rejects malformed
          // series data and the chart frame keeps rendering scales but
          // not candles. Surfacing the error explicitly turns the
          // long-standing "price chart blank" mystery into something we
          // can grep for in user devtools.
          console.error(
            '[VniBB PriceChart] series.setData failed for symbol',
            request.symbol,
            'mode',
            effectiveMode,
            'sample point',
            safePoints[0],
            'error',
            setDataError,
          );
          throw setDataError;
        }
        mainSeriesRef.current = series;
        series.setMarkers(
          eventMarkers.map((marker) => ({
            time: marker.date,
            position: marker.position,
            color: liveMarkerColor(marker),
            shape: marker.shape,
            text: marker.shortLabel,
          }))
        );

        if (activeCompareSymbol && safeComparePoints.length > 0) {
          const compareSeries = chart.addLineSeries({
            color: compareColor,
            lineWidth: 2,
            priceScaleId: 'right',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
          });
          const firstClose = safeComparePoints[0]?.close;
          compareSeries.setData(
            safeComparePoints
              .filter((point) => firstClose && firstClose > 0 && Number.isFinite(point.close))
              .map((point) => ({
                time: point.time,
                value: (point.close / firstClose) * (safePoints[0]?.close || firstClose),
              }))
          );
        }

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
        const histogramData = (up: string, down: string): Array<HistogramData | WhitespaceData> =>
          points.map((point) => isRenderablePoint(point) && point.volume !== null
            ? {
                time: point.time,
                value: point.volume,
                color: hexToRgba(point.close >= point.open ? up : down, 0.35),
              }
            : { time: point.time });
        const liveVolumeData = histogramData(upColor, downColor);
        volumeSeries.setData(liveVolumeData);
        // A canvas bakes its colours into pixels, so the exporter cannot lighten
        // it with CSS. Register a synchronous light render: the exporter asks,
        // this chart repaints on light tokens, hands over a bitmap, then puts the
        // live theme back. The user's theme preference is never touched.
        const captureHost = containerRef.current;
        const originalChartOptions = {
          layout: { background: { type: ColorType.Solid, color: bgPrimary }, textColor: textMuted },
          grid: { vertLines: { color: borderSubtle }, horzLines: { color: borderSubtle } },
          crosshair: {
            vertLine: { color: textMuted, labelBackgroundColor: bgSecondary },
            horzLine: { color: textMuted, labelBackgroundColor: bgSecondary },
          },
          rightPriceScale: { borderColor },
          timeScale: { borderColor },
        };
        const candleSeries = effectiveMode === 'candles' ? (series as ISeriesApi<'Candlestick'>) : null;
        const lineSeries = effectiveMode === 'line' ? (series as ISeriesApi<'Line'>) : null;
        const areaSeries = effectiveMode === 'area' ? (series as ISeriesApi<'Area'>) : null;
        const captureLight = (event: Event) => {
          const detail = (event as CustomEvent<ChartLightCaptureDetail>).detail;
          if (!detail) return;
          // No dark fallback: the live tokens are dark, so substituting them
          // would hand the exporter a dark bitmap that looks like success.
          const token = (name: string) => {
            const value = detail.token(name).trim();
            if (!value) throw new Error(`light capture token ${name} is missing`);
            return value;
          };
          try {
            const lightUp = token('--color-positive');
            const lightDown = token('--color-negative');
            const lightFocal = token('--chart-blue');
            chart.applyOptions({
              layout: { background: { type: ColorType.Solid, color: token('--bg-primary') }, textColor: token('--text-muted') },
              grid: {
                vertLines: { color: token('--border-subtle') },
                horzLines: { color: token('--border-subtle') },
              },
              crosshair: {
                vertLine: { color: token('--text-muted'), labelBackgroundColor: token('--bg-secondary') },
                horzLine: { color: token('--text-muted'), labelBackgroundColor: token('--bg-secondary') },
              },
              rightPriceScale: { borderColor: token('--border-color') },
              timeScale: { borderColor: token('--border-color') },
            });
            candleSeries?.applyOptions({
              upColor: lightUp, downColor: lightDown,
              borderUpColor: lightUp, borderDownColor: lightDown,
              wickUpColor: lightUp, wickDownColor: lightDown,
            });
            lineSeries?.applyOptions({ color: lightFocal });
            // Markers carry a per-theme token; the dark pastels measure 1.8-2.7:1
            // on the white export, so they are re-applied from the light cascade.
            series.setMarkers(eventMarkers.map((marker) => ({
              time: marker.date,
              position: marker.position,
              color: resolveMarkerColor(marker, (name) => token(name)),
              shape: marker.shape,
              text: marker.shortLabel,
            })));
            areaSeries?.applyOptions({
              lineColor: lightFocal,
              topColor: hexToRgba(lightFocal, 0.35),
              bottomColor: hexToRgba(lightFocal, 0.04),
            });
            // Volume bars carry their own baked colour, so they are re-set for
            // the snapshot and restored from the same points afterwards.
            volumeSeries.setData(histogramData(lightUp, lightDown));
            const bitmap = chart.takeScreenshot();
            // An empty bitmap would be pasted over the widget as a blank box.
            if (!bitmap.width || !bitmap.height) throw new Error('the chart screenshot is empty');
            detail.canvas = bitmap;
          } catch (captureError) {
            // `dispatchEvent` swallows listener exceptions, so the exporter can
            // only learn about the failure through the detail it passed in.
            detail.canvas = undefined;
            detail.error = captureError;
          } finally {
            // Restore the live chart even when the snapshot threw. A restore
            // failure leaves the widget light, so it must fail the export too.
            try {
              chart.applyOptions(originalChartOptions);
              candleSeries?.applyOptions({
                upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
                wickUpColor: upColor, wickDownColor: downColor,
              });
              lineSeries?.applyOptions({ color: focalColor });
              series.setMarkers(eventMarkers.map((marker) => ({
                time: marker.date,
                position: marker.position,
                color: liveMarkerColor(marker),
                shape: marker.shape,
                text: marker.shortLabel,
              })));
              areaSeries?.applyOptions({
                lineColor: focalColor,
                topColor: hexToRgba(focalColor, 0.35),
                bottomColor: hexToRgba(focalColor, 0.04),
              });
              volumeSeries.setData(liveVolumeData);
            } catch (restoreError) {
              detail.canvas = undefined;
              detail.error ??= restoreError;
            }
          }
        };
        if (captureHost) {
          removeCaptureListener?.();
          captureHost.setAttribute(LIGHT_CAPTURE_ATTR, '');
          captureHost.addEventListener(CHART_CAPTURE_EVENT, captureLight);
          removeCaptureListener = () => {
            captureHost.removeEventListener(CHART_CAPTURE_EVENT, captureLight);
            captureHost.removeAttribute(LIGHT_CAPTURE_ATTR);
          };
        }
        const admittedPoints = new Map(points.filter(isRenderablePoint).map((point) => [point.time, point]));
        chart.subscribeCrosshairMove((event) => {
          if (disposed) return;
          const time = typeof event.time === 'string' ? event.time
            : event.time && typeof event.time === 'object'
              ? `${event.time.year}-${String(event.time.month).padStart(2, '0')}-${String(event.time.day).padStart(2, '0')}`
              : null;
          setHoveredPoint(time && event.point && event.seriesData.has(series) ? admittedPoints.get(time) ?? null : null);
        });

        // Show the most recent ~120 bars (about 6 trading months) by
        // default. Calling fitContent() with a multi-year dataset
        // compressed candles to sub-pixel widths and made them invisible
        // (QA-v2 CC1/T1). setVisibleLogicalRange keeps the user's
        // chosen timeframe queryable while ensuring candles render at a
        // readable size.
        const visibleBars = Math.min(points.length, 180);
        if (visibleBars > 0) {
          try {
            chart.timeScale().setVisibleLogicalRange({
              from: Math.max(0, points.length - visibleBars),
              to: points.length - 1,
            });
          } catch (rangeError) {
            // QA-v3 F4/T1: if setVisibleLogicalRange rejects the range
            // (can happen when the chart is mid-resize), fall back to
            // fitContent which always works once data is present.
            console.warn('[VniBB PriceChart] setVisibleLogicalRange failed, falling back to fitContent', rangeError);
            chart.timeScale().fitContent();
          }
        } else {
          chart.timeScale().fitContent();
        }
      } catch (chartError) {
        if (disposed) return;
        removeChart(chartRef.current);
        chartRef.current = null;
        mainSeriesRef.current = null;
        volumeSeriesRef.current = null;

        if (isChartDimensionError(chartError)) {
          scheduleRenderRetry();
          return;
        }

        setCanvasError({ request, message: 'The chart could not be rendered.' });
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
        // A positive-size observation is real progress, not another blind frame:
        // when the host mounts detached the container is 0x0, so the RAF budget
        // in scheduleRenderRetry can be spent before it is ever attached and the
        // chart stays blank until unrelated state changes. Resetting here keeps
        // the retries bounded pre-attachment while letting the actual size change
        // start the chart.
        retryCount = 0;
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
        setCanvasError({ request, message: 'The chart could not be resized.' });
      }
    });
    resizeObserver.observe(containerRef.current);

    void renderChart();

    return () => {
      disposed = true;
      clearRetryFrame();
      removeCaptureListener?.();
      resizeObserver?.disconnect();
      removeChart(chartRef.current);
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [activeCompareSymbol, colorblind, comparePoints, eventMarkers, mode, points, request, resolvedTheme]);

  return (
    <div className={cn('relative h-full w-full', className)} style={{ minHeight: height }}>
      {points.length > 0 && <div ref={containerRef} className="absolute inset-0 h-full w-full" />}

      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 p-1 backdrop-blur">
        {(['adjusted', 'raw'] as const).map((modeOption) => (
          <button
            key={modeOption}
            type="button"
            onClick={() => setAdjustmentMode(modeOption)}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
              adjustmentMode === modeOption
                ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
          >
            {modeOption}
          </button>
        ))}
      </div>
      {!isLoading && !error && points.some(isChartPoint) ? (
        <div className="pointer-events-none absolute left-3 top-12 z-10 max-w-[calc(100%-24px)] rounded border border-[var(--border-default)] bg-[var(--bg-modal)]/90 px-2 py-1 text-[10px] text-[var(--text-primary)]" aria-label="Chart units and session basis">
          <div>Price unit: {points.find(isChartPoint)?.priceUnit || 'Unknown'} · {adjustmentMode} · Session basis: {sessionBasis} · Adjustment coverage: {adjustmentCoverage === null ? 'Unknown' : `${adjustmentCoverage}%`}</div>
          {hoveredPoint ? <div aria-label="OHLCV hover summary">{hoveredPoint.time} · O {hoveredPoint.open.toLocaleString()} · H {hoveredPoint.high.toLocaleString()} · L {hoveredPoint.low.toLocaleString()} · C {hoveredPoint.close.toLocaleString()} · Volume {hoveredPoint.volume?.toLocaleString() ?? 'Unknown'}</div> : <div>Hover a reported session for OHLCV.</div>}
        </div>
      ) : null}

      {eventMarkers.length > 0 ? (
        <div className="pointer-events-none absolute bottom-7 left-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 px-2 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur">
          <span>D reported dividend event</span>
          <span>•</span>
          <span>S split</span>
          <span>•</span>
          <span>R rights</span>
        </div>
      ) : null}

      {activeCompareSymbol && comparePoints.length > 0 ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] backdrop-blur">
          Compare {activeCompareSymbol}
        </div>
      ) : null}

      {!isLoading && !error && (excludedNotice || historyDelivery || comparison?.warning) ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 max-w-xs rounded-lg border border-[var(--border-default)] bg-[var(--bg-modal)]/90 px-2 py-1 text-[10px] text-[var(--text-secondary)] backdrop-blur">
          {historyDelivery && (
            <div role="status" aria-label="History delivery">
              {historyDelivery.partial && 'Showing partial price history. '}
              {historyDelivery.fallback && 'History includes fallback data.'}
            </div>
          )}
          {excludedNotice && <div role="status">{excludedNotice}</div>}
          {comparison?.warning && <div role="status" aria-label="Comparison history">{comparison.warning}</div>}
        </div>
      ) : null}

      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)' }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-modal)] px-4 py-3 text-xs text-[var(--text-secondary)] shadow-xl">
            <RefreshCw size={14} className="animate-spin text-[var(--color-accent-primary)]" />
            <span>Loading chart data...</span>
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div
          role="status"
          aria-label="History unavailable"
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 82%, transparent)' }}
        >
          <div className="max-w-sm rounded-xl border border-[var(--color-state-border)] bg-[var(--bg-modal)] px-4 py-3 text-center text-xs text-[var(--text-secondary)] shadow-xl">
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
