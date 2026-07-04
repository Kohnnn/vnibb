'use client';

import { PredictionMarketSourceWidget } from './PredictionMarketSource';

/**
 * Kalshi prediction markets widget. Internally delegates to the shared
 * PredictionMarketSourceWidget factory so adding more sources (PredictIt,
 * Limitless, etc.) is a one-line change.
 */
export function KalshiWidget() {
    return <PredictionMarketSourceWidget source="kalshi" title="Kalshi" />;
}
