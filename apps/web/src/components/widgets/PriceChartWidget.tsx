'use client';

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
    createChart,
    type IChartApi,
    ColorType,
    type Time,
    type ISeriesApi,
    type CandlestickData,
    type LineData,
    type HistogramData,
    CrosshairMode,
    type MouseEventParams,
} from 'lightweight-charts';
import { useHistoricalPrices, useFullTechnicalAnalysis, useRSRatingHistory } from '@/lib/queries';
import { usePriceStream } from '@/lib/hooks/useWebSocket';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import {
    RefreshCw, AlertCircle, Clock, Wifi, WifiOff,
    Settings, Maximize2, LineChart, BarChart3,
    Layers, TrendingUp, Type, Trash2, ChevronDown,
    Minus, Hash, Activity
} from 'lucide-react';
import { ExportButton } from '@/components/common/ExportButton';
import { exportHistorical } from '@/lib/api';
import * as chartUtils from '@/lib/chartUtils';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuCheckboxItem,
    DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

// Types
type ChartType = 'candlestick' | 'line' | 'area' | 'ohlc' | 'heikinashi';
type TimeframeType = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';
type DrawingTool = 'cursor' | 'trendline' | 'horizontal' | 'fibonacci' | 'text';

interface Annotation {
    id: string;
    type: 'trendline' | 'horizontal' | 'fibonacci' | 'text';
    points: { time: Time; price: number }[];
    color: string;
    text?: string;
}

interface CrosshairData {
    time: Time | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    change: number | null;
    changePct: number | null;
}

interface PriceChartWidgetProps {
    id: string;
    symbol: string;
    timeframe?: string;
    isEditing?: boolean;
    onRemove?: () => void;
    enableRealtime?: boolean;
    lastRefresh?: number;
}


// Timeframe options
const TIMEFRAMES: { value: TimeframeType; label: string }[] = [
    { value: '1D', label: '1D' },
    { value: '5D', label: '5D' },
    { value: '1M', label: '1M' },
    { value: '3M', label: '3M' },
    { value: '6M', label: '6M' },
    { value: '1Y', label: '1Y' },
    { value: '5Y', label: '5Y' },
    { value: 'ALL', label: 'All' },
];

import { useChartAnnotations } from '@/hooks/useChartAnnotations';
import { AnnotationToolbar } from '@/components/chart/AnnotationToolbar';
import { useLinkedSymbol } from '@/hooks/useLinkedSymbol';
import { IndicatorPanel, type IndicatorConfig } from '@/components/chart/IndicatorPanel';

export function PriceChartWidget({
    id,
    symbol: initialSymbol,
    timeframe = '1M',
    isEditing,
    onRemove,
    enableRealtime = true,
    lastRefresh,
}: PriceChartWidgetProps) {
    const { symbol, setSymbol, isLinked, toggleLink } = useLinkedSymbol({
        widgetId: id,
        defaultSymbol: initialSymbol,
    });

    const [isIndicatorPanelOpen, setIsIndicatorPanelOpen] = useState(false);
    const [indicatorConfigs, setIndicatorConfigs] = useState<IndicatorConfig[]>([
        { id: 'sma20', name: 'SMA 20', type: 'overlay', enabled: false },
        { id: 'sma50', name: 'SMA 50', type: 'overlay', enabled: false },
        { id: 'ema12', name: 'EMA 12', type: 'overlay', enabled: false },
        { id: 'bb', name: 'Bollinger Bands', type: 'overlay', enabled: false },
        { id: 'rsi', name: 'RSI (14)', type: 'oscillator', enabled: false },
        { id: 'macd', name: 'MACD', type: 'oscillator', enabled: false },
    ]);

    const {
        annotations,
        selectedTool,
        setSelectedTool,
        activeColor,
        setActiveColor,
        addAnnotation,
        clearAllAnnotations,
    } = useChartAnnotations(symbol);

    const activeOverlays = useMemo(() => 
        indicatorConfigs.filter(c => c.type === 'overlay' && c.enabled).map(c => c.id),
    [indicatorConfigs]);

    const activeIndicators = useMemo(() => 
        indicatorConfigs.filter(c => c.type === 'oscillator' && c.enabled).map(c => c.id),
    [indicatorConfigs]);

    const toggleIndicatorConfig = useCallback((id: string) => {
        setIndicatorConfigs(prev => prev.map(c => 
            c.id === id ? { ...c, enabled: !c.enabled } : c
        ));
    }, []);

    const chartContainerRef = useRef<HTMLDivElement>(null);

    const chartRef = useRef<IChartApi | null>(null);
    const mainSeriesRef = useRef<ISeriesApi<'Candlestick' | 'Line' | 'Area' | 'Bar'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const [timedOut, setTimedOut] = useState(false);

    // Chart Configuration
    const [chartType, setChartType] = useState<ChartType>('candlestick');
    const [currentTimeframe, setCurrentTimeframe] = useState<TimeframeType>(timeframe as TimeframeType);

    // Crosshair tooltip data
    const [crosshairData, setCrosshairData] = useState<CrosshairData | null>(null);

    // Series refs for overlays and indicators
    const overlaySeriesRefs = useRef<Record<string, ISeriesApi<'Line'>[]>>({});
    const indicatorSeriesRefs = useRef<Record<string, ISeriesApi<'Line' | 'Histogram'>[]>>({});

    const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
    const [drawingState, setDrawingState] = useState<{
        startPoint: { time: Time; price: number } | null;
    } | null>(null);

    // Real-time price streaming
    const {
        price: realtimePrice,
        isConnected,
        marketStatus
    } = usePriceStream(symbol, enableRealtime && currentTimeframe === '1D');

    // Calculate date range based on timeframe
    const dateRange = useMemo(() => {
        return chartUtils.getDateRangeForTimeframe(currentTimeframe);
    }, [currentTimeframe]);

    const { data, isLoading, error, refetch } = useHistoricalPrices(symbol, {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        interval: dateRange.interval,
        enabled: !!symbol,
    });

    // Full TA data for complex indicators
    const { data: taData } = useFullTechnicalAnalysis(symbol, {
        timeframe: currentTimeframe === '1D' ? 'D' : currentTimeframe,
        enabled: activeOverlays.includes('ichimoku') || activeIndicators.length > 0
    });

    // RS History for overlay
    const { data: rsHistory } = useRSRatingHistory(symbol, 250, activeOverlays.includes('rs_line'));

    // Refresh when requested by parent
    useEffect(() => {
        if (lastRefresh) {
            refetch();
        }
    }, [lastRefresh, refetch]);

    // Timeout detection
    useEffect(() => {
        if (isLoading) {
            setTimedOut(false);
            const timer = setTimeout(() => setTimedOut(true), 15000);
            return () => clearTimeout(timer);
        }
    }, [isLoading]);

    const handleRetry = () => {
        setTimedOut(false);
        refetch();
    };

    // Transform data for chart
    const processedData = useMemo(() => {
        if (!data?.data) return [];

        let rawData = data.data.map((item) => ({
            time: item.time as Time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
        }));

        if (chartType === 'heikinashi') {
            return chartUtils.transformHeikinAshi(rawData as chartUtils.OHLCData[]);
        }

        return rawData;
    }, [data, chartType]);

    const chartData = useMemo(() => {
        return processedData.map(item => ({
            time: item.time as Time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume,
        }));
    }, [processedData]);

    const volumeData = useMemo(() => {
        return processedData.map((item) => ({
            time: item.time as Time,
            value: item.volume || 0,
            color: item.close >= item.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        }));
    }, [processedData]);

    // Helper to clear all overlay series
    const clearOverlaySeries = useCallback(() => {
        Object.values(overlaySeriesRefs.current).forEach(seriesArr => {
            seriesArr.forEach(series => {
                try {
                    chartRef.current?.removeSeries(series);
                } catch { /* ignore */ }
            });
        });
        overlaySeriesRefs.current = {};
    }, []);

    // Helper to clear all indicator series
    const clearIndicatorSeries = useCallback(() => {
        Object.values(indicatorSeriesRefs.current).forEach(seriesArr => {
            seriesArr.forEach(series => {
                try {
                    chartRef.current?.removeSeries(series);
                } catch { /* ignore */ }
            });
        });
        indicatorSeriesRefs.current = {};
    }, []);

    // Create chart once on mount
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af',
            },
            grid: {
                vertLines: { color: 'rgba(75, 85, 99, 0.2)' },
                horzLines: { color: 'rgba(75, 85, 99, 0.2)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    width: 1,
                    color: 'rgba(59, 130, 246, 0.5)',
                    style: 2,
                    labelBackgroundColor: '#3b82f6',
                },
                horzLine: {
                    width: 1,
                    color: 'rgba(59, 130, 246, 0.5)',
                    style: 2,
                    labelBackgroundColor: '#3b82f6',
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(75, 85, 99, 0.3)',
            },
            timeScale: {
                borderColor: 'rgba(75, 85, 99, 0.3)',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        chartRef.current = chart;

        let mainSeries: ISeriesApi<'Candlestick' | 'Line' | 'Area' | 'Bar'>;

        if (chartType === 'line') {
            mainSeries = chart.addLineSeries({
                color: '#3b82f6',
                lineWidth: 2,
            });
        } else if (chartType === 'area') {
            mainSeries = chart.addAreaSeries({
                lineColor: '#3b82f6',
                topColor: 'rgba(59, 130, 246, 0.4)',
                bottomColor: 'rgba(59, 130, 246, 0.0)',
                lineWidth: 2,
            });
        } else if (chartType === 'ohlc') {
            mainSeries = chart.addBarSeries({
                upColor: '#22c55e',
                downColor: '#ef4444',
            });
        } else {
            mainSeries = chart.addCandlestickSeries({
                upColor: '#22c55e',
                downColor: '#ef4444',
                borderUpColor: '#22c55e',
                borderDownColor: '#ef4444',
                wickUpColor: '#22c55e',
                wickDownColor: '#ef4444',
            });
        }
        mainSeriesRef.current = mainSeries;

        const volumeSeries = chart.addHistogramSeries({
            color: '#3b82f6',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!chartRef.current || !mainSeriesRef.current || chartData.length === 0) return;

        if (chartType === 'line' || chartType === 'area') {
            mainSeriesRef.current.setData(chartData.map(d => ({ time: d.time, value: d.close })));
        } else {
            mainSeriesRef.current.setData(chartData);
        }

        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.setData(volumeData);
        }

        applyOverlays(chartRef.current, processedData as chartUtils.OHLCData[], activeOverlays);
        applyIndicators(chartRef.current, processedData as chartUtils.OHLCData[], activeIndicators);
        chartRef.current.timeScale().fitContent();
    }, [chartData, volumeData, chartType, activeOverlays, activeIndicators, processedData]);

    const applyOverlays = (chart: IChartApi, data: chartUtils.OHLCData[], overlays: string[]) => {
        clearOverlaySeries();
        overlays.forEach(overlay => {
            const series: ISeriesApi<'Line'>[] = [];
            if (overlay === 'sma20') {
                const smaData = chartUtils.calculateSMA(data, 20);
                const s = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, title: 'SMA 20' });
                s.setData(smaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'sma50') {
                const smaData = chartUtils.calculateSMA(data, 50);
                const s = chart.addLineSeries({ color: '#10b981', lineWidth: 1, title: 'SMA 50' });
                s.setData(smaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'sma200') {
                const smaData = chartUtils.calculateSMA(data, 200);
                const s = chart.addLineSeries({ color: '#ef4444', lineWidth: 1, title: 'SMA 200' });
                s.setData(smaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'ema12') {
                const emaData = chartUtils.calculateEMA(data, 12);
                const s = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, title: 'EMA 12' });
                s.setData(emaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'ema26') {
                const emaData = chartUtils.calculateEMA(data, 26);
                const s = chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, title: 'EMA 26' });
                s.setData(emaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'ema50') {
                const emaData = chartUtils.calculateEMA(data, 50);
                const s = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, title: 'EMA 50' });
                s.setData(emaData as LineData<Time>[]);
                series.push(s);
            } else if (overlay === 'bb') {
                const { upper, middle, lower } = chartUtils.calculateBollingerBands(data, 20, 2);
                const uSeries = chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.6)', lineWidth: 1, lineStyle: 2 });
                const mSeries = chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.4)', lineWidth: 1 });
                const lSeries = chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.6)', lineWidth: 1, lineStyle: 2 });
                uSeries.setData(upper as LineData<Time>[]);
                mSeries.setData(middle as LineData<Time>[]);
                lSeries.setData(lower as LineData<Time>[]);
                series.push(uSeries, mSeries, lSeries);
            } else if (overlay === 'rs_line' && rsHistory) {
                const s = chart.addLineSeries({
                    color: '#f97316',
                    lineWidth: 2,
                    priceScaleId: 'rs',
                    title: 'RS Rating',
                });
                s.priceScale().applyOptions({
                    scaleMargins: { top: 0.1, bottom: 0.7 },
                });
                s.setData(rsHistory as any);
                series.push(s);
            }
            if (series.length > 0) overlaySeriesRefs.current[overlay] = series;
        });
    };

    const applyIndicators = (chart: IChartApi, data: chartUtils.OHLCData[], indicators: string[]) => {
        clearIndicatorSeries();
        indicators.forEach(indicator => {
            const series: ISeriesApi<'Line' | 'Histogram'>[] = [];
            if (indicator === 'rsi') {
                const rsiData = chartUtils.calculateRSI(data, 14);
                const rsiSeries = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, priceScaleId: 'rsi', title: 'RSI (14)' });
                rsiSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0.02 } });
                rsiSeries.setData(rsiData as LineData<Time>[]);
                series.push(rsiSeries);
            } else if (indicator === 'macd') {
                const { macdLine, signalLine, histogram } = chartUtils.calculateMACD(data);
                const mLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceScaleId: 'macd', title: 'MACD' });
                const sLine = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'macd', title: 'Signal' });
                const hist = chart.addHistogramSeries({ priceScaleId: 'macd' });
                mLine.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0.02 } });
                mLine.setData(macdLine as LineData<Time>[]);
                sLine.setData(signalLine as LineData<Time>[]);
                hist.setData(histogram.map(h => ({ ...h, color: h.value >= 0 ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)' })) as HistogramData<Time>[]);
                series.push(mLine, sLine, hist as ISeriesApi<'Histogram'>);
            }
            if (series.length > 0) indicatorSeriesRefs.current[indicator] = series;
        });
    };

    const formatVolume = (vol: number | null): string => {
        if (vol === null) return '-';
        if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
        if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
        if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
        return vol.toFixed(0);
    };

    const formatPrice = (price: number | null): string => {
        if (price === null) return '-';
        return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    const handleChartClick = useCallback((e: React.MouseEvent) => {
        if (selectedTool === 'select' || !chartRef.current) return;

        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Convert pixel coordinates to price
        const price = mainSeriesRef.current?.coordinateToPrice(y);

        if (selectedTool === 'horizontal' && price !== null && price !== undefined) {
            addAnnotation({
                type: 'horizontal_line',
                price,
                color: activeColor,
                lineWidth: 1,
                symbol, // Need to add symbol here as well or use hook internal
            } as any);
            setSelectedTool('select');
        }
    }, [selectedTool, activeColor, addAnnotation, setSelectedTool, symbol]);

    // Render horizontal lines
    useEffect(() => {
        if (!chartRef.current || !mainSeriesRef.current) return;

        const series = mainSeriesRef.current;
        const lines = annotations.filter(a => a.type === 'horizontal_line');
        
        // Lightweight charts doesn't have an easy "clear all price lines"
        // Usually we'd store refs. For simplicity here:
        const priceLines = lines.map(line => {
            if (line.type === 'horizontal_line') {
                return series.createPriceLine({
                    price: line.price,
                    color: line.color,
                    lineWidth: (line.lineWidth || 1) as any,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: line.label || '',
                });
            }
            return null;
        }).filter(Boolean);

        return () => {
            priceLines.forEach(l => {
                if (l) series.removePriceLine(l);
            });
        };
    }, [annotations]);

    return (
        <WidgetContainer
            title="Price Chart"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading}
            noPadding
            widgetId={id}
            showLinkToggle={true}
        >
            <div className="relative w-full h-full flex flex-col bg-[#0a0a0a]">
                {/* Simplified Toolbar for Container */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm z-20">
                    <div className="flex items-center gap-2">
                        <AnnotationToolbar
                            selectedTool={selectedTool}
                            onToolChange={setSelectedTool}
                            activeColor={activeColor}
                            onColorChange={setActiveColor}
                            onClearAll={clearAllAnnotations}
                            annotationCount={annotations.length}
                        />
                        <div className="h-4 w-[1px] bg-gray-700 mx-1" />
                        <div className="flex items-center bg-gray-800 rounded p-0.5">
                            {TIMEFRAMES.slice(2, 6).map((tf) => (
                                <button
                                    key={tf.value}
                                    onClick={() => setCurrentTimeframe(tf.value)}
                                    className={cn(
                                        "px-2 py-0.5 text-[9px] font-bold rounded transition-colors",
                                        currentTimeframe === tf.value ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-300"
                                    )}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>
                        <button 
                            onClick={() => setIsIndicatorPanelOpen(!isIndicatorPanelOpen)} 
                            className={cn("p-1 transition-colors", isIndicatorPanelOpen ? "text-blue-400" : "text-gray-500 hover:text-white")}
                            title="Technical Indicators"
                        >
                             <Layers size={14} />
                        </button>
                        <div className="h-4 w-[1px] bg-gray-700" />
                        <button onClick={() => setChartType(chartType === 'candlestick' ? 'line' : 'candlestick')} className="p-1 text-gray-500 hover:text-white">
                             {chartType === 'candlestick' ? <LineChart size={14} /> : <BarChart3 size={14} />}
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-1">
                         {enableRealtime && currentTimeframe === '1D' && (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-800/50 rounded text-[9px]">
                                {isConnected ? <span className="text-green-500 font-bold">LIVE</span> : <span className="text-gray-500">OFFLINE</span>}
                            </div>
                        )}
                        <ExportButton
                            onExport={async (format) => {
                                await exportHistorical(symbol, { interval: currentTimeframe, format });
                            }}
                            variant="ghost"
                            className="text-gray-400 hover:text-white h-7 w-7 p-1"
                        />
                    </div>
                </div>

                {/* Chart Container */}
                <div className="relative flex-1 w-full overflow-hidden" onClick={handleChartClick}>
                    <div ref={chartContainerRef} className="w-full h-full min-h-[200px]" />
                    
                    {isLoading && !timedOut && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                        </div>
                    )}

                    {error || timedOut ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-10 p-4 text-center">
                            <p className="text-red-400 text-xs mb-2">{timedOut ? 'Request timed out' : 'Failed to load chart'}</p>
                            <Button variant="outline" size="sm" onClick={handleRetry} className="h-7 text-[10px]">Retry</Button>
                        </div>
                    ) : chartData.length === 0 && !isLoading ? (
                         <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">No data</div>
                    ) : null}

                    <IndicatorPanel 
                        configs={indicatorConfigs} 
                        onToggle={toggleIndicatorConfig} 
                        isOpen={isIndicatorPanelOpen} 
                        onClose={() => setIsIndicatorPanelOpen(false)} 
                    />
                </div>
            </div>
        </WidgetContainer>
    );
}

export default PriceChartWidget;
