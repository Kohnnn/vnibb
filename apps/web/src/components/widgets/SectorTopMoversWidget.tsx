'use client';

import { memo, useState, useRef, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Layers, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockPerformance {
  symbol: string;
  price: number;
  change_pct: number;
  volume?: number;
}

interface SectorData {
  sector: string;
  sector_vi: string;
  stocks: StockPerformance[];
}

function SectorTopMoversWidgetComponent({ id, onRemove }: { id: string, onRemove?: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewType, setViewType] = useState<'gainers' | 'losers'>('gainers');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sector-top-movers-v2', viewType],
    queryFn: async () => {
        const res = await fetch(`/api/v1/sectors/top-movers?type=${viewType}`);
        if (!res.ok) throw new Error('Sector data failed');
        return res.json();
    },
    refetchInterval: 60000,
  });

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -250 : 250,
        behavior: 'smooth',
      });
    }
  };

  const headerActions = (
    <div className="flex bg-gray-900 rounded p-0.5 border border-gray-800 mr-2">
      {(['gainers', 'losers'] as const).map(type => (
        <button
          key={type}
          onClick={() => setViewType(type)}
          className={cn(
            "px-2 py-0.5 text-[9px] font-black uppercase rounded transition-all",
            viewType === type 
                ? (type === 'gainers' ? "bg-green-600 text-white" : "bg-red-600 text-white") 
                : "text-gray-500 hover:text-gray-300"
          )}
        >
          {type}
        </button>
      ))}
    </div>
  );

  const sectors = data?.sectors || [];

  return (
    <WidgetContainer 
      title="Sector Movers"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading || isRefetching}
      headerActions={headerActions}
      noPadding
    >
      <div className="h-full flex flex-col relative group/widget">
        {/* Scroll buttons */}
        <button 
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 p-1.5 bg-black/80 text-white rounded-r-lg border-r border-y border-gray-800 opacity-0 group-hover/widget:opacity-100 transition-opacity"
        >
          <ChevronLeft size={16} />
        </button>
        <button 
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-1.5 bg-black/80 text-white rounded-l-lg border-l border-y border-gray-800 opacity-0 group-hover/widget:opacity-100 transition-opacity"
        >
          <ChevronRight size={16} />
        </button>

        {/* Sector columns */}
        <div 
          ref={scrollRef}
          className="flex-1 flex overflow-x-auto scrollbar-hide select-none bg-black"
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center w-full text-gray-600 gap-2">
                <RefreshCw className="animate-spin" size={24} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Scanning Sectors...</span>
            </div>
          ) : sectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center w-full text-gray-600 gap-2 opacity-50 uppercase font-black text-[10px] tracking-widest">
                <Layers size={32} strokeWidth={1} />
                No Sector Data
            </div>
          ) : (
            sectors.map((sector: SectorData, idx: number) => (
              <SectorColumn 
                key={`${sector.sector}-${idx}`} 
                sector={sector} 
                viewType={viewType}
              />
            ))
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function SectorColumn({ sector, viewType }: { sector: SectorData; viewType: string }) {
  const stocks = sector.stocks || [];
  const avgChange = useMemo(() => {
      if (stocks.length === 0) return 0;
      return stocks.reduce((acc, s) => acc + (s.change_pct || 0), 0) / stocks.length;
  }, [stocks]);
  
  const isPositive = avgChange >= 0;

  return (
    <div className="min-w-[150px] border-r border-gray-800/50 last:border-r-0 flex flex-col bg-[#050505]">
      {/* Sector header */}
      <div className={cn(
          "px-3 py-2 border-b border-gray-800 transition-colors sticky top-0 bg-[#0d0d0d] z-10",
          isPositive ? "border-b-green-900/30" : "border-b-red-900/30"
      )}>
        <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest truncate mb-0.5">{sector.sector_vi || sector.sector}</div>
        <div className={cn(
            "text-[11px] font-black flex items-center justify-between",
            isPositive ? "text-green-500" : "text-red-500"
        )}>
          <span>{isPositive ? '+' : ''}{avgChange.toFixed(2)}%</span>
          <span className="text-[8px] text-gray-600">{stocks.length}</span>
        </div>
      </div>
      
      {/* Stock rows */}
      <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-gray-800/20">
        {stocks.map(stock => (
          <StockRow key={stock.symbol} stock={stock} />
        ))}
      </div>
    </div>
  );
}

function StockRow({ stock }: { stock: StockPerformance }) {
  const isPositive = (stock.change_pct || 0) >= 0;
  
  return (
    <div className={cn(
        "flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-all cursor-pointer group",
        isPositive 
            ? (stock.change_pct || 0) > 4 ? "bg-green-500/10" : "bg-transparent"
            : (stock.change_pct || 0) < -4 ? "bg-red-500/10" : "bg-transparent"
    )}>
      <div className="flex flex-col">
        <span className="text-xs font-black text-blue-400 group-hover:text-blue-300 transition-colors">{stock.symbol}</span>
        {stock.volume && (
            <span className="text-[8px] font-bold text-gray-600">
                {(stock.volume / 1000).toFixed(0)}K
            </span>
        )}
      </div>
      <div className="text-right">
        <div className={cn(
            "text-[11px] font-black font-mono",
            isPositive ? "text-green-500" : "text-red-500"
        )}>
          {isPositive ? '+' : ''}{(stock.change_pct || 0).toFixed(1)}%
        </div>
        <div className="text-[9px] font-bold text-gray-300 font-mono">
            {stock.price.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export const SectorTopMoversWidget = memo(SectorTopMoversWidgetComponent);
export default SectorTopMoversWidget;
