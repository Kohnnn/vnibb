import { DEFAULT_TICKER } from '@/lib/defaultTicker';

export type WidgetGroupId = 'global' | 'A' | 'B' | 'C' | 'D';

export interface WidgetGroupConfig {
  id: WidgetGroupId;
  name: string;
  color: string;
  symbol: string;
}

export const DEFAULT_GROUPS: Record<WidgetGroupId, WidgetGroupConfig> = {
  global: { id: 'global', name: 'Global', color: '#6366f1', symbol: DEFAULT_TICKER },
  A: { id: 'A', name: 'Group A', color: '#ef4444', symbol: DEFAULT_TICKER },
  B: { id: 'B', name: 'Group B', color: '#22c55e', symbol: DEFAULT_TICKER },
  C: { id: 'C', name: 'Group C', color: '#3b82f6', symbol: DEFAULT_TICKER },
  D: { id: 'D', name: 'Group D', color: '#f59e0b', symbol: DEFAULT_TICKER },
};
