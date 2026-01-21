'use client';

import { useScreenerData } from '@/lib/queries';
import { formatRatio, formatPercent, formatVND } from '@/lib/formatters';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

interface ValuationWidgetProps {
  symbol: string;
  onDataChange?: (data: any) => void;
}

export function ValuationWidget({ symbol, onDataChange }: ValuationWidgetProps) {
  // Fetch peer data for comparison
  const { data: peerData, isLoading, error, refetch } = useScreenerData({
    limit: 10,
    // In a real app we'd fetch peers by sector
  });

  const stocks = peerData?.data || [];
  const currentStock = stocks.find(s => s.ticker === symbol) || stocks[0];

  if (isLoading) return <WidgetSkeleton variant="chart" />;
  if (error) return <WidgetError error={error as Error} onRetry={() => refetch()} />;
  if (!stocks.length) return <WidgetEmpty message="No valuation data" />;

  const chartData = stocks.slice(0, 8).map(s => ({
    name: s.ticker,
    pe: s.pe || 0,
    pb: s.pb || 0,
    isCurrent: s.ticker === symbol
  }));

  return (
    <div className="p-4 flex flex-col h-full space-y-4 overflow-hidden">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#0d0d0d] p-3 rounded-lg border border-[#1a1a1a]">
          <span className="text-[10px] text-gray-500 uppercase font-bold">P/E Ratio</span>
          <div className="text-xl font-bold text-white mt-1">
            {formatRatio(currentStock?.pe)}
          </div>
        </div>
        <div className="bg-[#0d0d0d] p-3 rounded-lg border border-[#1a1a1a]">
          <span className="text-[10px] text-gray-500 uppercase font-bold">P/B Ratio</span>
          <div className="text-xl font-bold text-white mt-1">
            {formatRatio(currentStock?.pb)}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[150px] w-full">
        <h3 className="text-[10px] text-gray-500 uppercase font-bold mb-4">Peer P/E Comparison</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#666', fontSize: 10 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#666', fontSize: 10 }}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #222', fontSize: '12px' }}
              itemStyle={{ color: '#fff' }}
            />
            <Bar dataKey="pe" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isCurrent ? '#3b82f6' : '#1e1e1e'} 
                  stroke={entry.isCurrent ? '#60a5fa' : '#333'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
