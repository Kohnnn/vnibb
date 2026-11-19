'use client';

import { createContext, useMemo, useState } from 'react';
import type { AdvancedChartMode, AdvancedChartTimeframe } from '@/components/chart/TradingViewAdvancedChart';
import { normalizePriceChartMode, normalizePriceChartTimeframe } from './priceChartControls';
import { buildWidgetRuntime } from './widgetRuntime';

export type PriceAdjustmentMode = 'raw' | 'adjusted';

export interface PriceHistoryRequest {
  readonly symbol: string;
  readonly timeframe: AdvancedChartTimeframe;
  readonly compareSymbol: string;
  readonly adjustmentMode: PriceAdjustmentMode;
  readonly startDate: string;
  readonly endDate: string;
  readonly interval: '1D';
}

export interface PriceHistoryStatus {
  readonly request: PriceHistoryRequest;
  readonly observationStatus: 'available' | 'empty' | 'unavailable';
  readonly coverage?: 'partial';
}

export interface PriceHistoryControl {
  readonly request: PriceHistoryRequest;
  readonly setAdjustmentMode: (mode: PriceAdjustmentMode) => void;
}

function resolveDateRange(timeframe: AdvancedChartTimeframe) {
  const end = new Date();
  const start = new Date(end);
  switch (timeframe) {
    case '1D': start.setDate(end.getDate() - 2); break;
    case '5D': start.setDate(end.getDate() - 7); break;
    case '1M': start.setDate(end.getDate() - 31); break;
    case '3M': start.setDate(end.getDate() - 93); break;
    case '6M': start.setDate(end.getDate() - 186); break;
    case '1Y': start.setDate(end.getDate() - 365); break;
    case '3Y': start.setDate(end.getDate() - 365 * 3); break;
    case '5Y': start.setDate(end.getDate() - 365 * 5); break;
    case 'MAX': start.setFullYear(2000, 0, 1); break;
    case 'YTD': start.setMonth(0, 1); break;
  }
  return { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] };
}

type HistorySelection = Pick<PriceHistoryRequest, 'symbol' | 'timeframe' | 'compareSymbol' | 'adjustmentMode'>;

export function usePriceHistoryRequest(selection: HistorySelection): PriceHistoryRequest;
export function usePriceHistoryRequest(selection: HistorySelection, enabled: boolean): PriceHistoryRequest | undefined;
export function usePriceHistoryRequest(
  { symbol, timeframe, compareSymbol: compareInput, adjustmentMode }: HistorySelection,
  enabled = true,
): PriceHistoryRequest | undefined {
  const dateRange = useMemo(() => enabled ? resolveDateRange(timeframe) : undefined, [enabled, timeframe]);
  const normalized = compareInput.trim().toUpperCase();
  const compareSymbol = normalized === symbol.trim().toUpperCase() ? '' : normalized;
  // Object identity is one selection, not a cache key: A -> B -> A needs a new result.
  return useMemo(() => dateRange && {
    ...dateRange, symbol, timeframe, compareSymbol, adjustmentMode, interval: '1D',
  }, [dateRange, symbol, timeframe, compareSymbol, adjustmentMode]);
}

interface ChartControls {
  readonly timeframe: AdvancedChartTimeframe;
  readonly chartType: AdvancedChartMode;
  readonly compareSymbol: string;
}

interface PriceChartScope {
  readonly controls: ChartControls;
  readonly request: PriceHistoryRequest | undefined;
  readonly updateControls: (updates: Partial<ChartControls>) => void;
  readonly setAdjustmentMode: PriceHistoryControl['setAdjustmentMode'];
}

export const PriceChartScopeContext = createContext<PriceChartScope | null>(null);

export function usePriceChartScope(
  symbol: string,
  config: Record<string, unknown> | undefined,
  enabled = true,
): PriceChartScope {
  const activeConfig = enabled ? config : undefined;
  const configured: ChartControls = {
    timeframe: normalizePriceChartTimeframe(activeConfig?.timeframe),
    chartType: normalizePriceChartMode(activeConfig?.chartType),
    compareSymbol: typeof activeConfig?.compareSymbol === 'string' ? activeConfig.compareSymbol.toUpperCase() : '',
  };
  const [state, setState] = useState(() => ({
    configured, enabled, controls: configured, adjustmentMode: 'adjusted' as PriceAdjustmentMode,
  }));
  if (state.enabled !== enabled || state.configured.timeframe !== configured.timeframe
    || state.configured.chartType !== configured.chartType || state.configured.compareSymbol !== configured.compareSymbol) {
    setState({
      configured, enabled, controls: configured,
      adjustmentMode: state.enabled === enabled ? state.adjustmentMode : 'adjusted',
    });
  }
  const { controls, adjustmentMode } = state;
  const request = usePriceHistoryRequest({
    symbol, timeframe: controls.timeframe, compareSymbol: controls.compareSymbol, adjustmentMode,
  }, enabled);
  return {
    controls,
    request,
    updateControls: updates => setState(current => ({ ...current, controls: { ...current.controls, ...updates } })),
    setAdjustmentMode: mode => setState(current => ({ ...current, adjustmentMode: mode })),
  };
}

export function buildPriceHistoryRuntime(request: PriceHistoryRequest, chartType: AdvancedChartMode, status?: PriceHistoryStatus) {
  const history = status?.request === request ? status : undefined;
  return buildWidgetRuntime({
    empty: !request.symbol,
    apiGroup: '/equity',
    endpoint: '/equity/historical',
    endpointKind: 'route_summary',
    sourceLabel: 'VniBB',
    observationStatus: request.symbol ? history?.observationStatus ?? 'loading' : 'empty',
    coverage: request.symbol ? history?.coverage : undefined,
    requestScope: request,
    extra: { timeframe: request.timeframe, chartType },
  });
}
