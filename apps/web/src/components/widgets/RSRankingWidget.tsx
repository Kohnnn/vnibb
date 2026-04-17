// RS Ranking Widget - Display RS leaders, laggards, and gainers

'use client';

import { useState } from 'react';
import { TrendingUp, Zap, RefreshCw } from 'lucide-react';
import { useRSLeaders, useRSLaggards, useRSGainers } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface RSRankingWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    widgetGroup?: WidgetGroupId;
}

type TabType = 'leaders' | 'laggards' | 'gainers';

function getRSColor(rating: number): string {
    if (rating >= 80) return 'text-green-400';
    if (rating >= 60) return 'text-cyan-400';
    if (rating >= 40) return 'text-yellow-400';
    if (rating >= 20) return 'text-orange-400';
    return 'text-red-400';
}

function getRSBg(rating: number): string {
    if (rating >= 80) return 'bg-green-500/20';
    if (rating >= 60) return 'bg-cyan-500/20';
    if (rating >= 40) return 'bg-yellow-500/20';
    if (rating >= 20) return 'bg-orange-500/20';
    return 'bg-red-500/20';
}

export function RSRankingWidget({ widgetGroup }: RSRankingWidgetProps) {
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

    const handleRefresh = () => {
        activeQuery.refetch();
    };

    const renderList = (items: any[], isLoading: boolean, error: unknown) => {
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
                        className="bg-[var(--bg-secondary)] border-[var(--border-color)] p-2 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
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
                                {stock.price && (
                                    <span className="text-[10px] text-[var(--text-secondary)] font-mono">{stock.price.toLocaleString()}</span>
                                )}
                                <div className="flex flex-col items-end">
                                    <Badge
                                        variant="outline"
                                        className={`text-xs font-bold border-none ${getRSBg(stock.rs_rating)} ${getRSColor(stock.rs_rating)}`}
                                    >
                                        {stock.rs_rating}
                                    </Badge>
                                    {stock.rs_rating_change !== undefined && activeTab === 'gainers' && (
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <TrendingUp size={10} className="text-green-400" />
                                            <span className="text-[9px] text-green-400 font-mono">+{stock.rs_rating_change}</span>
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
                    <Zap size={14} className="text-blue-400" />
                    <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">RS Rankings</span>
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta
                        updatedAt={activeQuery.dataUpdatedAt}
                        isFetching={activeQuery.isFetching && hasData}
                        isCached={isFallback}
                        note={activeTab === 'leaders' ? 'Leaders' : activeTab === 'laggards' ? 'Laggards' : 'Gainers'}
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
                    <TabsTrigger value="leaders" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-green-400">
                        Leaders
                    </TabsTrigger>
                    <TabsTrigger value="laggards" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-red-400">
                        Laggards
                    </TabsTrigger>
                    <TabsTrigger value="gainers" className="text-[10px] text-[var(--text-muted)] data-[state=active]:bg-[var(--bg-tertiary)] data-[state=active]:text-blue-400">
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
