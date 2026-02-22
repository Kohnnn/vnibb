'use client';

import { useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { TradingViewAdvancedChart } from '@/components/chart/TradingViewAdvancedChart';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { useProfile } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';

interface TradingViewChartWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

export function TradingViewChartWidget({ id, symbol, onRemove }: TradingViewChartWidgetProps) {
  const { data: profileData, isFetching, dataUpdatedAt } = useProfile(symbol, !!symbol);
  const exchange = profileData?.data?.exchange;

  const tvSymbol = useMemo(() => toTradingViewSymbol(symbol, exchange), [symbol, exchange]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view TradingView" />;
  }

  return (
    <WidgetContainer
      title="TradingView Chart"
      symbol={symbol}
      widgetId={id}
      onClose={onRemove}
      noPadding
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching}
            note={tvSymbol || (exchange ? exchange.toUpperCase() : 'TradingView')}
            align="right"
          />
        </div>
        <div className="flex-1">
          <ChartSizeBox className="h-full" minHeight={220}>
            {() => (
              <TradingViewAdvancedChart
                symbol={tvSymbol || symbol}
                exchange={exchange}
                interval="D"
                height={320}
              />
            )}
          </ChartSizeBox>
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TradingViewChartWidget;
