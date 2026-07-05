'use client';

import { BarChart3 } from 'lucide-react';
import { PredictionMarketSourceWidget } from './PredictionMarketSource';

/**
 * Limitless widget. Thin wrapper around the shared source factory
 * (Phase 7.3 pattern).
 */
export function LimitlessWidget() {
    return (
        <PredictionMarketSourceWidget
            source="limitless"
            title="Limitless"
            emptyIcon={<BarChart3 size={18} />}
        />
    );
}