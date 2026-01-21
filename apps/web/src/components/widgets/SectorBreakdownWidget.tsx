'use client';

import { memo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// Mock data based on VN Market common sectors
const SECTOR_DATA = [
  { name: 'Financials', value: 35, color: '#3b82f6' },
  { name: 'Real Estate', value: 25, color: '#f59e0b' },
  { name: 'Consumer Staples', value: 15, color: '#10b981' },
  { name: 'Industrials', value: 10, color: '#8b5cf6' },
  { name: 'Materials', value: 8, color: '#ef4444' },
  { name: 'Utilities', value: 7, color: '#06b6d4' },
];

function SectorBreakdownWidgetComponent() {
  return (
    <WidgetContainer title="Market Sector Breakdown">
      <div className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={SECTOR_DATA}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={5}
              dataKey="value"
            >
              {SECTOR_DATA.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #334155', borderRadius: '8px' }}
              itemStyle={{ color: '#fff', fontSize: '10px' }}
            />
            <Legend 
                verticalAlign="bottom" 
                height={36} 
                iconType="circle"
                wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetContainer>
  );
}

export const SectorBreakdownWidget = memo(SectorBreakdownWidgetComponent);
export default SectorBreakdownWidget;
