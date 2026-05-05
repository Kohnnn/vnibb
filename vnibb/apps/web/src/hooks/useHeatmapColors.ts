import { useMemo } from 'react';

interface HeatmapOptions {
  min?: number;
  max?: number;
  midpoint?: number;
  positiveColor?: string;
  negativeColor?: string;
  neutralColor?: string;
}

export function useHeatmapColors(
  values: number[],
  options: HeatmapOptions = {}
) {
  // Filter out any non-numeric values to prevent issues with Math.min/max
  const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  const {
    min = numericValues.length > 0 ? Math.min(...numericValues) : 0,
    max = numericValues.length > 0 ? Math.max(...numericValues) : 100,
    midpoint = 0,
    positiveColor = 'rgba(34, 197, 94, 0.3)', // green-500
    negativeColor = 'rgba(239, 68, 68, 0.3)', // red-500
    neutralColor = 'transparent'
  } = options;

  return useMemo(() => {
    return (value: number): string => {
      if (typeof value !== 'number' || isNaN(value)) return neutralColor;
      if (value === midpoint) return neutralColor;
      
      if (value > midpoint) {
        // Avoid division by zero if max === midpoint
        const divisor = max - midpoint;
        if (divisor === 0) return positiveColor;
        const intensity = Math.min(Math.max((value - midpoint) / divisor, 0), 1);
        return positiveColor.replace('0.3', String(0.1 + intensity * 0.4));
      } else {
        // Avoid division by zero if midpoint === min
        const divisor = midpoint - min;
        if (divisor === 0) return negativeColor;
        const intensity = Math.min(Math.max((midpoint - value) / divisor, 0), 1);
        return negativeColor.replace('0.3', String(0.1 + intensity * 0.4));
      }
    };
  }, [values, min, max, midpoint, positiveColor, negativeColor, neutralColor]);
}
