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
      "widget-container h-full min-h-0 flex flex-col",
      "bg-secondary rounded-lg",
      "border border-default",
      shouldHideHeader ? "overflow-visible" : "overflow-hidden",
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
      {shouldHideHeader && headerActions && (
        <div className="flex shrink-0 items-center justify-end gap-2 overflow-x-auto border-b border-[var(--border-color)] px-2 py-1" aria-label={`${title} controls`}>
          {headerActions}
        </div>
      )}
      <div className={cn(
        "min-h-0 flex-1",
        shouldHideHeader ? "overflow-visible" : "overflow-auto scrollbar-hide",
        bodyClassName
      )}>
        {children}
      </div>
    </div>
  );
}

export default WidgetContainer;
