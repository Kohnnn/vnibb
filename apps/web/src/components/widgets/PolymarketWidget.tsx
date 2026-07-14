'use client';

import { SourceWidget } from './SourceWidget';

export function PolymarketWidget({ config }: { readonly config?: Record<string, unknown> }) {
    return <SourceWidget source="polymarket" title="Polymarket" config={config} />;
}