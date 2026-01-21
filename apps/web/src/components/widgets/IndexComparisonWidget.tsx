'use client';

import { memo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useMarketOverview } from '@/lib/queries';
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const INDICES = [
  { symbol: 'VNINDEX', name: 'VN-Index' },
  { symbol: 'VN30', name: 'VN30' },
  { symbol: 'HNX', name: 'HNX-Index' },
  { symbol: 'UPCOM', name: 'UPCOM-Index' },
];

function IndexComparisonWidgetComponent() {
  const { data: indices, isLoading } = useMarketOverview();
  const dataList = indices?.data || [];

  return (
    <WidgetContainer title="Index Comparison">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 h-full">
        {INDICES.map(index => {
          const data = dataList.find((i: any) => 
            i.index_name === index.symbol || 
            i.index_name === index.name ||
            (index.symbol === 'VNINDEX' && i.index_name === 'VN-INDEX')
          );
          
          const isUp = (data?.change_pct || 0) >= 0;
          
          return (
            <div 
              key={index.symbol}
              className="p-3 bg-gray-900/40 rounded-lg border border-gray-800 flex flex-col justify-between hover:border-gray-700 transition-colors"
            >
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{index.name}</div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-lg font-black text-white">
                    {data?.current_value?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}
                </div>
                <div className={cn(
                    "flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded",
                    isUp ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
                )}>
                    {isUp ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                    {isUp ? '+' : ''}{data?.change_pct?.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetContainer>
  );
}

export const IndexComparisonWidget = memo(IndexComparisonWidgetComponent);
export default IndexComparisonWidget;
