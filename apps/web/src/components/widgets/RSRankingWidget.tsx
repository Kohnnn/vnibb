// RS Ranking Widget - Display RS leaders, laggards, and gainers

'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Zap, RefreshCw, Filter } from 'lucide-react';
import { useRSLeaders, useRSLaggards, useRSGainers } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface RSRankingWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
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

export function RSRankingWidget({ isEditing, onRemove }: RSRankingWidgetProps) {
    const [activeTab, setActiveTab] = useState<TabType>('leaders');
    const [limit] = useState(50);

    const { data: leadersData, isLoading: leadersLoading, refetch: refetchLeaders } = useRSLeaders(limit);
    const { data: laggardsData, isLoading: laggardsLoading, refetch: refetchLaggards } = useRSLaggards(limit);
    const { data: gainersData, isLoading: gainersLoading, refetch: refetchGainers } = useRSGainers(limit, 7);

    const handleRefresh = () => {
        if (activeTab === 'leaders') refetchLeaders();
        else if (activeTab === 'laggards') refetchLaggards();
        else refetchGainers();
    };

    const isLoading = activeTab === 'leaders' ? leadersLoading : activeTab === 'laggards' ? laggardsLoading : gainersLoading;

    return (
        <div className="h-full flex flex-col space-y-3 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Zap size={14} className="text-blue-400" />
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">RS Rankings</span>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                >
                    <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="grid w-full grid-cols-3 bg-gray-900 border border-gray-800 p-0.5 h-8">
                    <TabsTrigger value="leaders" className="text-[10px] data-[state=active]:bg-gray-800 data-[state=active]:text-green-400">
                        Leaders
                    </TabsTrigger>
                    <TabsTrigger value="laggards" className="text-[10px] data-[state=active]:bg-gray-800 data-[state=active]:text-red-400">
                        Laggards
                    </TabsTrigger>
                    <TabsTrigger value="gainers" className="text-[10px] data-[state=active]:bg-gray-800 data-[state=active]:text-blue-400">
                        Gainers
                    </TabsTrigger>
                </TabsList>

                {/* Leaders Tab */}
                <TabsContent value="leaders" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {leadersLoading ? (
                        <div className="space-y-2 px-1">
                            {[...Array(10)].map((_, i) => (
                                <Skeleton key={i} className="h-14 w-full rounded bg-gray-800/50" />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1 px-1">
                            {leadersData?.leaders?.map((stock, index) => (
                                <Card
                                    key={stock.symbol}
                                    className="bg-gray-900/40 border-gray-800 p-2 hover:bg-gray-800/60 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="text-[10px] text-gray-500 font-mono w-6 text-right">
                                                #{index + 1}
                                            </span>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-xs font-bold text-white truncate">
                                                    {stock.symbol}
                                                </span>
                                                <span className="text-[9px] text-gray-500 truncate">
                                                    {stock.company_name || stock.industry}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {stock.price && (
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    {stock.price.toLocaleString()}
                                                </span>
                                            )}
                                            <Badge
                                                variant="outline"
                                                className={`text-xs font-bold border-none ${getRSBg(stock.rs_rating)} ${getRSColor(stock.rs_rating)}`}
                                            >
                                                {stock.rs_rating}
                                            </Badge>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Laggards Tab */}
                <TabsContent value="laggards" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {laggardsLoading ? (
                        <div className="space-y-2 px-1">
                            {[...Array(10)].map((_, i) => (
                                <Skeleton key={i} className="h-14 w-full rounded bg-gray-800/50" />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1 px-1">
                            {laggardsData?.laggards?.map((stock, index) => (
                                <Card
                                    key={stock.symbol}
                                    className="bg-gray-900/40 border-gray-800 p-2 hover:bg-gray-800/60 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="text-[10px] text-gray-500 font-mono w-6 text-right">
                                                #{index + 1}
                                            </span>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-xs font-bold text-white truncate">
                                                    {stock.symbol}
                                                </span>
                                                <span className="text-[9px] text-gray-500 truncate">
                                                    {stock.company_name || stock.industry}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {stock.price && (
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    {stock.price.toLocaleString()}
                                                </span>
                                            )}
                                            <Badge
                                                variant="outline"
                                                className={`text-xs font-bold border-none ${getRSBg(stock.rs_rating)} ${getRSColor(stock.rs_rating)}`}
                                            >
                                                {stock.rs_rating}
                                            </Badge>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Gainers Tab */}
                <TabsContent value="gainers" className="flex-1 overflow-y-auto scrollbar-hide mt-2">
                    {gainersLoading ? (
                        <div className="space-y-2 px-1">
                            {[...Array(10)].map((_, i) => (
                                <Skeleton key={i} className="h-14 w-full rounded bg-gray-800/50" />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1 px-1">
                            {gainersData?.gainers?.map((stock, index) => (
                                <Card
                                    key={stock.symbol}
                                    className="bg-gray-900/40 border-gray-800 p-2 hover:bg-gray-800/60 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="text-[10px] text-gray-500 font-mono w-6 text-right">
                                                #{index + 1}
                                            </span>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-xs font-bold text-white truncate">
                                                    {stock.symbol}
                                                </span>
                                                <span className="text-[9px] text-gray-500 truncate">
                                                    {stock.company_name || stock.industry}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {stock.price && (
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    {stock.price.toLocaleString()}
                                                </span>
                                            )}
                                            <div className="flex flex-col items-end">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs font-bold border-none ${getRSBg(stock.rs_rating)} ${getRSColor(stock.rs_rating)}`}
                                                >
                                                    {stock.rs_rating}
                                                </Badge>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <TrendingUp size={10} className="text-green-400" />
                                                    <span className="text-[9px] text-green-400 font-mono">
                                                        +{stock.rs_rating_change}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
