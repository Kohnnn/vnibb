// RS Ranking Widget - Display RS leaders, laggards, and gainers

'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Zap, RefreshCw } from 'lucide-react';
import { useRSLeaders, useRSLaggards, useRSGainers } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { EMPTY_VALUE } from '@/lib/units';
import type { RSPriceUnit, RSStockItem } from '@/lib/api';
import type { WidgetGroupId } from '@/types/widget';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { deriveWidgetHealth } from '@/lib/widgetHealth';

interface RSRankingWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    widgetGroup?: WidgetGroupId;
    onDataChange?: (data: WidgetDataPayload) => void;
}

type TabType = 'leaders' | 'laggards' | 'gainers';

// An RS rating is an ordinal score, not a gain or a loss, so it gets a
// single-hue sequential ramp: one accent, strength rising with the score. A
// five-hue rainbow (green/cyan/yellow/orange/red) read as bullish/bearish data
// that the number does not contain, and red at the bottom implied a loss.
// The badge is a score label, not a filled gauge: the tint stays low and the
// number uses the primary ink. Accent-on-accent-tint cannot clear AA at any
// useful strength (accent text on a 60% accent tint measured 1.75:1), and a
// solid fill with accent text hid a perfect score at 1:1.
const RS_MAX_TINT = 45;

export function getRSColor(): string {
    // One legible foreground for the whole ramp: ink clears AA on every tint of
    // the accent (worst case measured 8.96:1), so the score never has to trade
    // readability for its own strength encoding.
    return 'text-[var(--text-primary)]';
}

export function getRSBg(rating: number): { background: string } {
    const score = Math.max(0, Math.min(100, rating));
    return { background: `color-mix(in srgb, var(--color-accent-primary) ${Math.round((score / 100) * RS_MAX_TINT)}%, transparent)` };
}

export interface RSPriceDisplay {
    /** What the row shows in the price column. Never a bare number for an unverified unit. */
    text: string;
    /** The certified unit shown beside the number, or null when unavailable. */
    unitLabel: 'VND' | 'pts' | null;
    /** Provenance for the row's tooltip; null when nothing was observed. */
    title: string | null;
}

function formatRSPriceValue(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

// #251: a stored snapshot price can carry `price_unit: "unknown"`. Printing that
// number beside unit-qualified ones turns an unverified magnitude into a
// comparison against VND, so an unverified unit renders as unavailable with its
// own reason instead of a bare number. Value and unit always travel together.
export function describeRSPrice(
    stock: Pick<RSStockItem, 'price' | 'price_unit' | 'price_asof' | 'price_source'>,
): RSPriceDisplay {
    // An undated stored price has no observation date of its own; neither the
    // ranking's calculation date nor the fetch time stands in for it.
    const asOf = stock.price_asof ? ` as of ${stock.price_asof}` : ', observation date unknown';
    const source = stock.price_source ? ` (${stock.price_source})` : '';
    const raw = stock.price;
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
        return { text: EMPTY_VALUE, unitLabel: null, title: 'Price unavailable: no stored price observation for this ranking row.' };
    }
    if (raw <= 0) {
        return {
            text: EMPTY_VALUE,
            unitLabel: null,
            title: `Price unavailable: the stored observation${asOf} is not a usable quote; a zero or negative value is reported as unavailable, not as a price.`,
        };
    }
    const unit: RSPriceUnit | null | undefined = stock.price_unit;
    if (unit === 'VND') {
        return { text: formatRSPriceValue(raw), unitLabel: 'VND', title: `Stored price${asOf}${source} in VND.` };
    }
    if (unit === 'index_points') {
        return { text: formatRSPriceValue(raw), unitLabel: 'pts', title: `Stored price${asOf}${source} in index points, not currency.` };
    }
    return {
        text: EMPTY_VALUE,
        unitLabel: null,
        title: `Price unavailable: the stored observation${asOf}${source} has no verified currency or scale, so its raw value is withheld rather than compared as VND.`,
    };
}

/** True when the row shows a number at all (certified unit, usable value). */
function isDisplayablePrice(
    stock: Pick<RSStockItem, 'price' | 'price_unit'>,
): boolean {
    const raw = stock.price;
    if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) return false;
    return stock.price_unit === 'VND' || stock.price_unit === 'index_points';
}

function latestDate(values: Array<string | null | undefined>): string | null {
    const dated = values.filter(
        (value): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime()),
    );
    if (dated.length === 0) return null;
    return dated.reduce((latest, value) => (new Date(value) > new Date(latest) ? value : latest));
}

export function RSRankingWidget({ widgetGroup, onDataChange }: RSRankingWidgetProps) {
    const [activeTab, setActiveTab] = useState<TabType>('leaders');
    const [limit] = useState(50);
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'rs_ranking' });

    const leadersQuery = useRSLeaders(limit);
    const laggardsQuery = useRSLaggards(limit);
    const gainersQuery = useRSGainers(limit, 7);

    const leaders = leadersQuery.data?.leaders || [];
    const laggards = laggardsQuery.data?.laggards || [];
    const gainers = gainersQuery.data?.gainers || [];

    const activeQuery = activeTab === 'leaders'
        ? leadersQuery
        : activeTab === 'laggards'
            ? laggardsQuery
            : gainersQuery;

    const activeItems = activeTab === 'leaders'
        ? leaders
        : activeTab === 'laggards'
            ? laggards
            : gainers;

    const hasData = activeItems.length > 0;
    const isFallback = Boolean(activeQuery.error && hasData);

    // Source observation dates only: the ranking's calculation date and each
    // price's own date. Query receipts stay in `fetchedAt`. A price without a
    // trade date keeps that gap visible rather than borrowing either clock.
    const priceAsOf = latestDate(activeItems.map((item) => item.price_asof));
    const ratingAsOf = latestDate(activeItems.map((item) => item.rating_asof));
    const unknownUnitCount = activeItems.filter(
        (item) => item.price != null && item.price_unit !== 'VND' && item.price_unit !== 'index_points',
    ).length;
    // Only a price the row actually shows can be "undated": zero, negative,
    // non-finite and unit-withheld values are already reported as unavailable.
    const undatedPriceCount = activeItems.filter(
        (item) => isDisplayablePrice(item) && !item.price_asof,
    ).length;
    const health = deriveWidgetHealth({ updatedAt: ratingAsOf, stale: isFallback });
    const warnings = useMemo(
        () => [
            ...(unknownUnitCount > 0
                ? [`${unknownUnitCount} price${unknownUnitCount === 1 ? '' : 's'} withheld: stored observation has no verified unit`]
                : []),
            ...(undatedPriceCount > 0
                ? [`${undatedPriceCount} price${undatedPriceCount === 1 ? '' : 's'} without a trade date: freshness unknown`]
                : []),
        ],
        [undatedPriceCount, unknownUnitCount],
    );

    useEffect(() => {
        const endpoint = activeTab === 'leaders'
            ? `/rs/leaders?limit=${limit}`
            : activeTab === 'laggards'
                ? `/rs/laggards?limit=${limit}`
                : `/rs/gainers?limit=${limit}&lookback_days=7`;

        onDataChange?.(buildWidgetRuntime({
            empty: !hasData,
            apiGroup: '/rs',
            endpoint,
            sourceLabel: `RS ${activeTab}`,
            lastDataDate: ratingAsOf,
            fetchedAt: activeQuery.dataUpdatedAt,
            cached: isFallback,
            coverage: unknownUnitCount > 0 || undatedPriceCount > 0 ? 'partial' : undefined,
            warnings,
            extra: {
                count: activeItems.length,
                limit,
                priceAsOf,
                unknownUnitCount,
                undatedPriceCount,
            },
        }));
    }, [activeItems.length, activeQuery.dataUpdatedAt, activeTab, hasData, isFallback, limit, onDataChange, priceAsOf, ratingAsOf, undatedPriceCount, unknownUnitCount, warnings]);

    const handleRefresh = () => {
        activeQuery.refetch();
    };

    const renderList = (items: RSStockItem[], isLoading: boolean, error: unknown) => {
        if (isLoading && items.length === 0) {
            return <WidgetSkeleton lines={6} />;
        }
        if (error && items.length === 0) {
            return <WidgetError error={error as Error} onRetry={() => activeQuery.refetch()} />;
        }
        if (items.length === 0) {
            return <WidgetEmpty message="No RS data available" icon={<TrendingUp size={18} />} />;
        }

        return (
            <div className="space-y-1 px-1">
                {items.map((stock: any, index: number) => (
                    <Card
                        key={`${stock.symbol}-${index}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setLinkedSymbol(stock.symbol)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setLinkedSymbol(stock.symbol);
                            }
                        }}
                        className="bg-[var(--bg-secondary)] border-[var(--border-color)] p-2 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-[10px] text-[var(--text-muted)] font-mono w-6 text-right">#{index + 1}</span>
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="break-words whitespace-normal text-xs font-bold text-[var(--text-primary)]">{stock.symbol}</span>
                                    <span className="break-words whitespace-normal text-[9px] text-[var(--text-muted)]">{stock.company_name || stock.industry}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* #251: value and unit render together, or the row shows
                                    an explicit unavailable state — never a bare number a
                                    reader could compare as if it were VND. */}
                                {(() => {
                                    const display = describeRSPrice(stock);
                                    return (
                                        <span
                                            data-testid={`rs-price-${stock.symbol}`}
                                            title={display.title ?? undefined}
                                            className="text-[10px] text-[var(--text-secondary)] font-mono whitespace-nowrap"
                                        >
                                            {display.text}
                                            {display.unitLabel && (
                                                <span className="ml-1 text-[9px] text-[var(--text-muted)]">{display.unitLabel}</span>
                                            )}
                                        </span>
                                    );
                                })()}
                                <div className="flex flex-col items-end">
                                    <Badge
                                        variant="outline"
                                        className={`text-xs font-bold border-none ${getRSColor()}`}
                                        style={getRSBg(stock.rs_rating)}
                                    >
                                        {stock.rs_rating}
                                    </Badge>
                                    {typeof stock.rs_rating_change === 'number' && activeTab === 'gainers' && (
                                        // Movement of an ordinal score, not a price return: it
                                        // keeps the score's single-hue ramp (sign + glyph carry
                                        // direction), so it never reads as profit or loss.
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <TrendingUp size={10} className={stock.rs_rating_change < 0 ? 'text-[var(--text-muted)]' : 'text-[var(--color-accent-primary)]'} />
                                            <span className={`text-[9px] font-mono ${stock.rs_rating_change < 0 ? 'text-[var(--text-muted)]' : 'text-[var(--color-accent-primary)]'}`}>
                                                {stock.rs_rating_change >= 0 ? '+' : ''}{stock.rs_rating_change}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        );
    };

    return (
        <div aria-label="RS rankings" className="h-full flex flex-col space-y-3 overflow-hidden">
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Zap size={14} className="text-[var(--color-accent-primary)]" />
                    <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">RS Rankings</span>
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta
                        updatedAt={ratingAsOf}
                        fetchedAt={activeQuery.dataUpdatedAt}
                        isFetching={activeQuery.isFetching && hasData}
                        isCached={isFallback}
                        health={hasData ? health : undefined}
                        note={[
                            activeTab === 'leaders' ? 'Leaders' : activeTab === 'laggards' ? 'Laggards' : 'Gainers',
                            priceAsOf ? `price as of ${priceAsOf}` : null,
                            undatedPriceCount > 0 ? `${undatedPriceCount} undated price${undatedPriceCount === 1 ? '' : 's'}` : null,
                            unknownUnitCount > 0 ? `${unknownUnitCount} price${unknownUnitCount === 1 ? '' : 's'} unverified` : null,
                        ].filter(Boolean).join(' · ')}
                        align="right"
                    />
                    <button
                        onClick={handleRefresh}
                        disabled={activeQuery.isFetching}
                        aria-label="Refresh RS rankings"
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                        type="button"
                    >
                        <RefreshCw size={12} className={activeQuery.isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="grid w-full grid-cols-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] p-0.5 h-8">
                    <TabsTrigger value="leaders" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-[var(--color-accent-secondary)]">
                        Leaders
                    </TabsTrigger>
                    <TabsTrigger value="laggards" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-[var(--color-accent-secondary)]">
                        Laggards
                    </TabsTrigger>
                    <TabsTrigger value="gainers" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-[var(--color-accent-secondary)]">
                        Gainers
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="leaders" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {renderList(leaders, leadersQuery.isLoading, leadersQuery.error)}
                </TabsContent>
                <TabsContent value="laggards" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {renderList(laggards, laggardsQuery.isLoading, laggardsQuery.error)}
                </TabsContent>
                <TabsContent value="gainers" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {renderList(gainers, gainersQuery.isLoading, gainersQuery.error)}
                </TabsContent>
            </Tabs>
        </div>
    );
}
