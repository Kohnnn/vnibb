import { useCallback } from 'react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import type { WidgetGroupId } from '@/types/widget';

interface WidgetSymbolAnalyticsContext {
  widgetId?: string;
  widgetType?: string;
  symbol?: string;
}

export function useWidgetSymbolLink(widgetGroup?: WidgetGroupId, analyticsContext?: WidgetSymbolAnalyticsContext) {
  const { setGlobalSymbol } = useSymbolLink();
  const { setGroupSymbol } = useWidgetGroups();

  const setLinkedSymbol = useCallback((symbol: string) => {
    if (!symbol) return;

    captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
      action: 'select_linked_symbol',
      widget_id: analyticsContext?.widgetId,
      widget_type: analyticsContext?.widgetType,
      symbol,
      previous_symbol: analyticsContext?.symbol,
      widget_group: widgetGroup,
    });

    if (widgetGroup && widgetGroup !== 'global') {
      setGroupSymbol(widgetGroup, symbol);
      return;
    }

    setGlobalSymbol(symbol);
    setGroupSymbol('global', symbol);
  }, [analyticsContext?.symbol, analyticsContext?.widgetId, analyticsContext?.widgetType, setGlobalSymbol, setGroupSymbol, widgetGroup]);

  return { setLinkedSymbol };
}
