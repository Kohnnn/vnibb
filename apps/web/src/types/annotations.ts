export type AnnotationType = 'horizontal_line' | 'trend_line' | 'text';

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  symbol: string;
  createdAt: number;
  color: string;
  lineWidth?: number;
}

export interface HorizontalLineAnnotation extends BaseAnnotation {
  type: 'horizontal_line';
  price: number;
  label?: string;
}

export interface TrendLineAnnotation extends BaseAnnotation {
  type: 'trend_line';
  startPoint: { time: number; price: number };
  endPoint: { time: number; price: number };
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  position: { time: number; price: number };
  text: string;
  fontSize?: number;
}

export type ChartAnnotation = HorizontalLineAnnotation | TrendLineAnnotation | TextAnnotation;

export const ANNOTATION_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#ffffff', // white
];
