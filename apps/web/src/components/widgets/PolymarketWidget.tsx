'use client';

import { BarChart3 } from 'lucide-react';
import { WidgetEmpty } from '@/components/ui/widget-states';

export function PolymarketWidget() {
    return (
        <div className="flex h-full items-center justify-center p-4">
            <WidgetEmpty
                message="Polymarket market data is not connected yet"
                icon={<BarChart3 size={18} />}
            />
        </div>
    );
}
