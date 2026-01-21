'use client';

import React, { ReactNode, useState, useCallback } from 'react';
import { WidgetHeader } from './WidgetHeader';
import { cn } from '@/lib/utils';
import { ExportButton } from './ExportButton';

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
  noPadding = false,
  exportData,
  exportFilename,
  widgetId,
  showLinkToggle = false,
  hideHeader = false,
}: WidgetContainerProps) {
  const [isMaximized, setIsMaximized] = useState(false);

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
      {!hideHeader && (
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
        "flex-1 overflow-auto scrollbar-hide",
        !noPadding && "p-3",
        bodyClassName
      )}>
        {children}
      </div>
      {exportData && (
        <div className="px-3 py-1 border-t border-gray-800 bg-gray-900/20 flex justify-end">
          <ExportButton 
            data={exportData} 
            filename={exportFilename || title?.toLowerCase().replace(/\s+/g, '_')} 
          />
        </div>
      )}
    </div>
  );
}

export default WidgetContainer;
