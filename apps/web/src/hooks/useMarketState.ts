'use client';

import { useEffect, useState } from 'react';
import { getMarketState, type MarketState } from '@/lib/marketHours';

/**
 * React hook that returns the current HOSE market state and updates on
 * a 30-second tick. Components can use it to auto-refresh on session
 * transitions (open / lunch / close) without manual refresh.
 */
export function useMarketState(intervalMs = 30_000): MarketState {
  const [state, setState] = useState<MarketState>(() => getMarketState());

  useEffect(() => {
    const tick = () => setState(getMarketState());
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return state;
}
