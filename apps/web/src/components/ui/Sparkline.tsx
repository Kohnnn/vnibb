import { Area, AreaChart } from 'recharts'

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
  
  return (
    <div style={{ width, height }}>
      <AreaChart width={chartWidth} height={chartHeight} data={chartData}>
        <Area
          type="monotone"
          dataKey="value"
          stroke={fillColor}
          fill={showArea ? `${fillColor}20` : 'transparent'}
          strokeWidth={1.5}
        />
      </AreaChart>
    </div>
  );
}
