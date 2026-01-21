'use client';

import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

interface MiniChartProps {
  data: { date: string; close: number }[];
  width?: number | string;
  height?: number;
  positive?: boolean;
}

export function MiniChart({ data, width = "100%", height = 40, positive }: MiniChartProps) {
  const color = positive ? '#10B981' : '#EF4444';
  
  if (!data || data.length === 0) {
      return <div className="h-[40px] w-full bg-gray-900/20 rounded animate-pulse" />;
  }

  return (
    <div style={{ width, height }}>
        <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
            <defs>
            <linearGradient id={`gradient-${positive ? 'pos' : 'neg'}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            </defs>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#gradient-${positive ? 'pos' : 'neg'})`}
            />
        </AreaChart>
        </ResponsiveContainer>
    </div>
  );
}
