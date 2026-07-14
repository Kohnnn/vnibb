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

type Selection = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
};

export function SourceWidget({ source, title, config }: SourceWidgetProps) {
    const [selection, setSelection] = useState<Selection | null>(null);
    const category = config?.category;
    const limit = config?.limit;
    const categoryValue = category === 'all' || category === 'economic' || category === 'sports' || category === 'politics' || category === 'crypto' || category === 'general'
        ? category
        : undefined;
    const limitValue = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 && limit <= 100
        ? limit
        : undefined;
    const handleSelect = (row: PredictionMarketRow) => {
        setSelection({
            source: row.source,
            sourceId: row.sourceId,
            question: row.question,
        });
    };
    return (
        <>
            <PredictionMarketSourceWidget
                source={source}
                title={title}
                category={categoryValue}
                limit={limitValue}
                onSelect={handleSelect}
            />
            <PredictionMarketDrawer
                source={selection?.source ?? null}
                sourceId={selection?.sourceId ?? null}
                question={selection?.question ?? null}
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