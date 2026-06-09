'use client';

import React, { ReactNode, useState, useCallback, useContext } from 'react';
import { WidgetHeader } from './WidgetHeader';
import { cn } from '@/lib/utils';

const WidgetHeaderVisibilityContext = React.createContext(false);

export function WidgetHeaderVisibilityProvider({
  hideHeader,
  children,
}: {
  hideHeader: boolean;
  children: ReactNode;
}) {
  return (
    <WidgetHeaderVisibilityContext.Provider value={hideHeader}>
      {children}
    </WidgetHeaderVisibilityContext.Provider>
  );
}

interface WidgetContainerProps {
  title: string;
  symbol?: string;
  subtitle?: string;
  children: ReactNode;
  onRefresh?: () => void;
  onClose?: () => void;
  isLoading?: boolean;
  className?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
  showSettings?: boolean;
  onSettingsClick?: () => void;
  noPadding?: boolean;
  exportData?: any[] | Record<string, any>;
  exportFilename?: string;
  widgetId?: string;
  showLinkToggle?: boolean;
  hideHeader?: boolean;
}

export function WidgetContainer({
  title,
  symbol,
  subtitle,
  children,
  onRefresh,
  onClose,
  isLoading = false,
  className = '',
  bodyClassName = '',
  headerActions,
  showSettings = false,
  onSettingsClick,
  exportData,
  exportFilename,
  widgetId,
  showLinkToggle = false,
  hideHeader = false,
}: WidgetContainerProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const inheritedHideHeader = useContext(WidgetHeaderVisibilityContext);
  const shouldHideHeader = hideHeader || inheritedHideHeader;

  const handleExpand = useCallback(() => {
    setIsMaximized(true);
  }, []);

  return (
    <div className={cn(
      "h-full flex flex-col",
      "bg-secondary rounded-lg",
      "border border-default",
      "overflow-hidden",
      className
    )}>
      {!shouldHideHeader && (
        <WidgetHeader
          title={title}
          symbol={symbol}
          subtitle={subtitle}
          onRefresh={onRefresh}
          onExpand={handleExpand}
          onSettings={showSettings ? onSettingsClick : undefined}
          onClose={onClose}
          isLoading={isLoading}
          actions={headerActions}
          widgetId={widgetId}
          showLinkToggle={showLinkToggle}
        />
      )}
      <div className={cn(
        "flex-1 overflow-auto scrollbar-hide min-h-0",
        // NOTE: outer padding is supplied by WidgetWrapper's content host
        // (`p-2 sm:p-2.5`), which wraps every widget. WidgetContainer therefore
        // does NOT add its own default padding — doing so double-padded the body.
        // `noPadding` is kept for backwards-compat but is now a no-op for the
        // default case; pass `bodyClassName` for any widget-specific insets.
        bodyClassName
      )}>
        {children}
      </div>
    </div>
  );
}

export default WidgetContainer;
