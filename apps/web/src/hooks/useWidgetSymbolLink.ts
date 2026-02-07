import { useCallback } from 'react';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import type { WidgetGroupId } from '@/types/widget';

export function useWidgetSymbolLink(widgetGroup?: WidgetGroupId) {
  const { setGlobalSymbol } = useSymbolLink();
  const { setGroupSymbol } = useWidgetGroups();

  const setLinkedSymbol = useCallback((symbol: string) => {
    if (!symbol) return;

    if (widgetGroup && widgetGroup !== 'global') {
      setGroupSymbol(widgetGroup, symbol);
      return;
    }

    setGlobalSymbol(symbol);
    setGroupSymbol('global', symbol);
  }, [setGlobalSymbol, setGroupSymbol, widgetGroup]);

  return { setLinkedSymbol };
}
