import { useState, useEffect } from 'react';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';

interface UseLinkedSymbolOptions {
  widgetId: string;
  defaultSymbol?: string;
  autoLink?: boolean;
}

export function useLinkedSymbol({
  widgetId,
  defaultSymbol = 'VNM',
  autoLink = true,
}: UseLinkedSymbolOptions) {
  const { globalSymbol, isWidgetLinked, toggleWidgetLink } = useSymbolLink();
  const [localSymbol, setLocalSymbol] = useState(defaultSymbol);
  const isLinked = isWidgetLinked(widgetId);

  // Auto-link on mount if autoLink is true
  useEffect(() => {
    if (autoLink && !isLinked) {
      toggleWidgetLink(widgetId);
    }
  }, [autoLink, widgetId, isLinked, toggleWidgetLink]);

  // The effective symbol is global if linked, otherwise local
  const symbol = isLinked ? globalSymbol : localSymbol;

  const setSymbol = (newSymbol: string) => {
    if (isLinked) {
      // If linked, we should ideally update global symbol or just set it
      // For now, let's keep it consistent with the context
      setLocalSymbol(newSymbol);
    } else {
      setLocalSymbol(newSymbol);
    }
  };

  return {
    symbol,
    setSymbol,
    isLinked,
    toggleLink: () => toggleWidgetLink(widgetId),
  };
}
