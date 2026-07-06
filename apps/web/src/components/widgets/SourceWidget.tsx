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
}

type Selection = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
};

export function SourceWidget({ source, title }: SourceWidgetProps) {
    const [selection, setSelection] = useState<Selection | null>(null);
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