'use client';

import { useState } from 'react';

import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { PredictionMarketDrawer } from './PredictionMarketDrawer';
import {
    PredictionMarketSourceWidget,
    type PredictionMarketRow,
    type PredictionMarketSource,
} from './PredictionMarketSource';

/**
 * SourceWidget — slim wrapper that pairs the shared
 * ``PredictionMarketSourceWidget`` body with a click-driven
 * ``PredictionMarketDrawer`` deep-dive.
 *
 * Used by PolymarketWidget, KalshiWidget, PredictItWidget,
 * LimitlessWidget, and ManifoldWidget so adding a new source stays a
 * one-line declarative change.
 */

export interface SourceWidgetProps {
    readonly source: PredictionMarketSource;
    readonly title: string;
    readonly config?: Record<string, unknown>;
}

export function SourceWidget({ source, title, config }: SourceWidgetProps) {
    const [selection, setSelection] = useState<PredictionMarketRow | null>(null);
    const category = config?.category;
    const limit = config?.limit;
    const categoryValue = category === 'all' || category === 'economic' || category === 'sports' || category === 'politics' || category === 'crypto' || category === 'general'
        ? category
        : undefined;
    const limitValue = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 && limit <= 100
        ? limit
        : undefined;
    return (
        <>
            <PredictionMarketSourceWidget
                source={source}
                title={title}
                category={categoryValue}
                limit={limitValue}
                onSelect={setSelection}
            />
            <PredictionMarketDrawer
                source={selection?.source ?? null}
                sourceId={selection?.sourceId ?? null}
                question={selection?.question ?? null}
                market={selection}
                key={selection ? `${selection.source}:${selection.sourceId}` : 'closed'}
                open={selection !== null}
                onClose={() => setSelection(null)}
            />
        </>
    );
}

/**
 * Re-export the context menu so callers that already import
 * ``SourceWidget`` can also wire up custom onSelect handlers in inline
 * forms. The component is a thin passthrough.
 */
export { PredictionMarketContextMenu };