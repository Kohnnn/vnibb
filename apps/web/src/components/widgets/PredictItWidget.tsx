'use client';

import { BarChart3 } from 'lucide-react';
import { PredictionMarketSourceWidget } from './PredictionMarketSource';

/**
 * PredictIt widget. Thin wrapper around the shared source factory
 * (Phase 7.3 pattern).
 */
export function PredictItWidget() {
    return (
        <PredictionMarketSourceWidget
            source="predictit"
            title="PredictIt"
            emptyIcon={<BarChart3 size={18} />}
        />
    );
}