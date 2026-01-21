// Sector Performance Widget - Industry sector heatmap

'use client';

import { useState } from 'react';
import { LayoutGrid, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface SectorData {
    name: string;
    shortName: string;
    changePct: number;
    marketCap: number; // in trillion VND
    stockCount: number;
}

interface SectorPerformanceWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock sector data for Vietnam market
const SECTORS: SectorData[] = [
    { name: 'Banking', shortName: 'Bank', changePct: 1.25, marketCap: 850, stockCount: 27 },
    { name: 'Real Estate', shortName: 'RE', changePct: -0.85, marketCap: 320, stockCount: 45 },
    { name: 'Securities', shortName: 'Sec', changePct: 2.15, marketCap: 125, stockCount: 15 },
    { name: 'Technology', shortName: 'Tech', changePct: 1.78, marketCap: 180, stockCount: 12 },
    { name: 'Retail', shortName: 'Retail', changePct: -1.45, marketCap: 95, stockCount: 18 },
    { name: 'Steel', shortName: 'Steel', changePct: 0.65, marketCap: 140, stockCount: 8 },
    { name: 'Food & Beverage', shortName: 'F&B', changePct: 0.35, marketCap: 210, stockCount: 22 },
    { name: 'Construction', shortName: 'Const', changePct: -0.28, marketCap: 85, stockCount: 35 },
    { name: 'Oil & Gas', shortName: 'O&G', changePct: 1.92, marketCap: 165, stockCount: 10 },
    { name: 'Utilities', shortName: 'Util', changePct: 0.12, marketCap: 95, stockCount: 14 },
];

function getHeatmapColor(changePct: number): string {
    if (changePct >= 2) return 'bg-green-600';
    if (changePct >= 1) return 'bg-green-500/70';
    if (changePct >= 0.5) return 'bg-green-400/50';
    if (changePct >= 0) return 'bg-green-300/30';
    if (changePct >= -0.5) return 'bg-red-300/30';
    if (changePct >= -1) return 'bg-red-400/50';
    if (changePct >= -2) return 'bg-red-500/70';
    return 'bg-red-600';
}

import { WidgetContainer } from '@/components/ui/WidgetContainer';

export function SectorPerformanceWidget({ isEditing, onRemove }: SectorPerformanceWidgetProps) {
    const [view, setView] = useState<'grid' | 'list'>('grid');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Sort by absolute change for grid emphasis
    const sortedSectors = [...SECTORS].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    const handleRefresh = () => {
        setIsRefreshing(true);
        setTimeout(() => setIsRefreshing(false), 500);
    };

    const headerActions = (
        <div className="flex bg-gray-800 rounded text-[10px] mr-2">
            <button
                onClick={() => setView('grid')}
                className={`px-3 py-1 rounded ${view === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
            >
                Grid
            </button>
            <button
                onClick={() => setView('list')}
                className={`px-3 py-1 rounded ${view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
            >
                List
            </button>
        </div>
    );

    return (
        <WidgetContainer
            title="Sector Performance"
            onRefresh={handleRefresh}
            onClose={onRemove}
            isLoading={isRefreshing}
            headerActions={headerActions}
            noPadding
        >
            <div className="h-full flex flex-col p-2">
                {/* Content */}
                <div className="flex-1 overflow-auto text-left">
                    {view === 'grid' ? (
                        <div className="grid grid-cols-2 gap-1.5">
                            {sortedSectors.map((sector) => {
                                const isUp = sector.changePct >= 0;
                                return (
                                    <div
                                        key={sector.name}
                                        className={`p-3 rounded-lg ${getHeatmapColor(sector.changePct)} cursor-pointer hover:opacity-90 transition-opacity flex flex-col justify-between min-h-[60px]`}
                                    >
                                        <div className="text-[10px] font-bold text-white/80 uppercase truncate">
                                            {sector.shortName}
                                        </div>
                                        <div className="text-base font-black text-white">
                                            {isUp ? '+' : ''}{sector.changePct.toFixed(2)}%
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {sortedSectors.map((sector) => {
                                const isUp = sector.changePct >= 0;
                                return (
                                    <div
                                        key={sector.name}
                                        className="flex items-center justify-between py-2 px-3 hover:bg-gray-800/30 rounded-lg transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${isUp ? 'bg-green-400' : 'bg-red-400'}`} />
                                            <span className="text-sm font-medium text-white">{sector.name}</span>
                                        </div>
                                        <span className={`text-sm font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                            {isUp ? '+' : ''}{sector.changePct.toFixed(2)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

