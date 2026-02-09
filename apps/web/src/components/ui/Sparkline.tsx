import { Area, AreaChart, Tooltip } from 'recharts'

interface SparklineProps {
  data: number[];
  width?: number | string;
  height?: number | string;
  color?: 'green' | 'red' | 'blue';
  showArea?: boolean;
}

export function Sparkline({ 
  data, 
  width = 60, 
  height = 20, 
  color = 'blue',
  showArea = true 
}: SparklineProps) {
  const chartData = data.map((value, index) => ({ value, index }));
  const startValue = data[0] ?? 0;
  const colorMap = {
    green: '#22c55e',
    red: '#ef4444', 
    blue: '#3b82f6'
  };
  
  const isPositive = data.length > 1 ? data[data.length - 1] > data[0] : true;
  const autoColor = isPositive ? colorMap.green : colorMap.red;
  const fillColor = color === 'blue' ? colorMap.blue : autoColor;
  const chartWidth = typeof width === 'number' ? width : 60;
  const chartHeight = typeof height === 'number' ? height : 20;
  
  const formatValue = (value: number) =>
    Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';

  const TrendTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) => {
    if (!active || !payload || payload.length === 0) return null;
    const value = payload[0]?.value ?? 0;
    const delta = value - startValue;
    const deltaPct = startValue ? (delta / startValue) * 100 : 0;
    const isUp = delta >= 0;

    return (
      <div className="rounded border border-white/10 bg-black/80 px-2 py-1 text-[10px] text-gray-200">
        <div className="font-semibold">{formatValue(value)}</div>
        <div className={isUp ? 'text-emerald-400' : 'text-red-400'}>
          {isUp ? '+' : ''}{formatValue(delta)} ({isUp ? '+' : ''}{deltaPct.toFixed(2)}%)
        </div>
      </div>
    );
  };

  return (
    <div style={{ width, height }}>
      <AreaChart width={chartWidth} height={chartHeight} data={chartData}>
        <Tooltip content={<TrendTooltip />} cursor={false} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={fillColor}
          fill={showArea ? `${fillColor}20` : 'transparent'}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </div>
  );
}
