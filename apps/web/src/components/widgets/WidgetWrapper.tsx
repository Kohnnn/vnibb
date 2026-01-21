// Enhanced Widget Wrapper with OpenBB-style controls and sync integration

'use client';

import React, { useState, useEffect, type ReactNode } from 'react';
import {
    Download,
    FileJson,
    FileSpreadsheet,
    Image,
    Maximize2,
    Minimize2,
    X,
    Settings,
    Move,
    Sparkles,
    Users,
    Check,
    MoreHorizontal,
    RefreshCw
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { WidgetGroupId } from '@/types/widget';
import { TickerCombobox } from './TickerCombobox';
import {
    WidgetParameterDropdown,
    WidgetMultiSelectDropdown,
    type WidgetParameter,
    type ParameterOption
} from './WidgetParameterDropdown';
import { WidgetToolbar } from '@/components/ui/WidgetToolbar';
import { WidgetErrorBoundary } from './ErrorBoundary';
import { MaximizedWidgetPortal } from './MaximizedWidgetPortal';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { exportToCSV, exportToJSON, exportToPNG } from '@/lib/exportWidget';


// Multi-select parameter interface
export interface WidgetMultiSelectParam {
    id: string;
    label: string;
    currentValues: string[];
    options: ParameterOption[];
    onChange: (values: string[]) => void;
}

export interface WidgetWrapperProps {
    id: string; // Widget Instance ID
    title: string;
    children: ReactNode;
    symbol?: string; // Current symbol passed to child
    tabId: string;
    dashboardId: string;
    syncGroupId?: number;
    widgetGroup?: WidgetGroupId;
    isEditing?: boolean;

    showTickerSelector?: boolean;
    showGroupLabels?: boolean; // Controls visibility of sync badge
    parameters?: WidgetParameter[]; // Inline parameter controls (OpenBB-style)
    multiSelectParams?: WidgetMultiSelectParam[]; // Multi-select params (for indicators)
    data?: any; // Data for export (CSV/JSON)
    onRemove?: () => void;

    onMaximize?: () => void;
    onRefresh?: () => void;
    onSymbolChange?: (symbol: string) => void;

    onSettingsClick?: () => void;
    onCopilotClick?: (context?: Record<string, unknown>) => void;
}

export function WidgetWrapper({
    id,
    title,
    children,
    symbol,
    tabId,
    dashboardId,
    syncGroupId,
    widgetGroup: initialWidgetGroup = 'global',
    isEditing = false,
    showTickerSelector = true,
    showGroupLabels = true,
    parameters = [],
    multiSelectParams = [],
    data: widgetData,
    onRemove,
    onMaximize,
    onRefresh,
    onSymbolChange,
    onSettingsClick,
    onCopilotClick
}: WidgetWrapperProps) {
    const { updateWidget } = useDashboard();
    const { getColorForGroup, getSymbolForGroup, groups, setGroupSymbol } = useWidgetGroups();
    const [isMaximized, setIsMaximized] = useState(false);
    const [isTickerDropdownOpen, setIsTickerDropdownOpen] = useState(false);
    const [widgetGroup, setWidgetGroup] = useState<WidgetGroupId>(initialWidgetGroup);
    const [internalData, setInternalData] = useState<any>(widgetData);

    // Sync widgetGroup state when prop changes
    useEffect(() => {
        setWidgetGroup(initialWidgetGroup);
    }, [initialWidgetGroup]);

    // Sync internal data with prop if provided
    useEffect(() => {
        if (widgetData) setInternalData(widgetData);
    }, [widgetData]);

    // Get current group details if assigned
    const effectiveSymbol = getSymbolForGroup(widgetGroup);
    // Priority: 
    // 1. Specific group symbol (A, B, C, D) if not global
    // 2. Legacy sync symbol (if provided via prop)
    // 3. Global group symbol
    const displaySymbol = (widgetGroup !== 'global') 
        ? effectiveSymbol 
        : (symbol || effectiveSymbol);




    const handleMaximize = () => {
        setIsMaximized(!isMaximized);
        onMaximize?.();
    };

    const handleSyncClick = () => {
        // Legacy sync logic removed in favor of Phase 2 groups
    };


    const handleGroupChange = (newGroup: WidgetGroupId) => {
        setWidgetGroup(newGroup);
        // Persist to dashboard state
        updateWidget(dashboardId, tabId, id, { widgetGroup: newGroup });
        
        // If joining a new group, update local symbol if needed
        const newSymbol = getSymbolForGroup(newGroup);
        if (newSymbol && onSymbolChange) onSymbolChange(newSymbol);
    };

    const handleTickerSelect = (newSymbol: string) => {
        if (newSymbol && newSymbol !== displaySymbol) {
            onSymbolChange?.(newSymbol);
            // Update the group symbol so other widgets in same group sync
            setGroupSymbol(widgetGroup, newSymbol);
        }
    };

    const handleExport = async (format: 'csv' | 'json' | 'png') => {
        const filename = `${title.replace(/\s+/g, '_')}_${displaySymbol}_${new Date().toISOString().split('T')[0]}`;
        const dataToExport = internalData || widgetData;

        switch (format) {
            case 'csv':
                if (dataToExport) {
                    const rows = Array.isArray(dataToExport) ? dataToExport : [dataToExport];
                    exportToCSV(rows, filename);
                }
                break;
            case 'json':
                if (dataToExport) {
                    exportToJSON(dataToExport, filename);
                }
                break;
            case 'png':
                await exportToPNG(id, filename);
                break;
        }
    };


    return (
        <>
            {/* Normal widget - dim when maximized */}
            <div
                className={cn(
                    "h-full flex flex-col rounded-md overflow-hidden",
                    "bg-secondary border transition-all duration-200",
                    isEditing ? 'ring-1 ring-blue-500/20' : '',
                    isMaximized ? 'opacity-30 pointer-events-none' : ''
                )}
                style={{
                    borderColor: widgetGroup !== 'global'
                        ? getColorForGroup(widgetGroup)
                        : 'var(--color-border-default)'
                }}
            >
                <WidgetToolbar
                    title={title}
                    symbol={displaySymbol}
                    showSymbolSelector={showTickerSelector}
                    onSymbolChange={() => setIsTickerDropdownOpen(true)}
                    showGroupSelector={showGroupLabels}
                    groupSelector={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="flex items-center justify-center w-5 h-5 rounded hover:bg-white/5 transition-colors"
                                    style={{
                                        borderLeft: `2px solid ${getColorForGroup(widgetGroup)}`
                                    }}
                                    title={`Widget Group: ${groups[widgetGroup]?.name || 'Global'}`}
                                >
                                    <Users size={12} className={widgetGroup !== 'global' ? 'text-white' : 'text-gray-600'} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-secondary border-default min-w-[120px]">
                                {Object.entries(groups).map(([id, config]) => (
                                    <DropdownMenuItem
                                        key={id}
                                        onClick={() => handleGroupChange(id as WidgetGroupId)}
                                        className="flex items-center gap-2 text-xs focus:bg-white/5 cursor-pointer text-primary"
                                    >
                                        <div
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: config.color }}
                                        />
                                        <span className="flex-1">{config.name}</span>
                                        {widgetGroup === id && <Check size={12} className="text-blue-500" />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                    tickerSelector={
                        <div className="relative flex items-center min-w-[40px]">
                            <span
                                onClick={() => setIsTickerDropdownOpen(true)}
                                className="text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-white/5 px-1 py-0.5 rounded cursor-pointer transition-colors"
                            >
                                {displaySymbol}
                            </span>
                            <TickerCombobox
                                isOpen={isTickerDropdownOpen}
                                onClose={() => setIsTickerDropdownOpen(false)}
                                currentSymbol={displaySymbol}
                                onSelect={handleTickerSelect}
                            />
                        </div>
                    }
                    parameters={
                        <div className="flex items-center gap-1">
                            {parameters.map((param) => (
                                <WidgetParameterDropdown key={param.id} parameter={param} />
                            ))}
                            {multiSelectParams.map((param) => (
                                <WidgetMultiSelectDropdown
                                    key={param.id}
                                    id={param.id}
                                    label={param.label}
                                    currentValues={param.currentValues}
                                    options={param.options}
                                    onChange={param.onChange}
                                />
                            ))}
                        </div>
                    }
                    isMaximized={isMaximized}
                    onMaximize={handleMaximize}
                    onRefresh={onRefresh}
                    onSettings={onSettingsClick}
                    onCopilot={() => onCopilotClick?.()}
                    onClose={onRemove}
                    actions={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="p-1 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded transition-colors">
                                    <MoreHorizontal size={11} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-secondary border-default min-w-[150px]">
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="text-xs focus:bg-white/5 cursor-pointer text-primary">
                                        <Download size={14} className="mr-2" />
                                        <span>Export</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="bg-secondary border-default">
                                        <DropdownMenuItem onClick={() => handleExport('csv')} className="text-xs focus:bg-white/5 cursor-pointer text-primary">
                                            <FileSpreadsheet size={14} className="mr-2" />
                                            <span>Export as CSV</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExport('json')} className="text-xs focus:bg-white/5 cursor-pointer text-primary">
                                            <FileJson size={14} className="mr-2" />
                                            <span>Export as JSON</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExport('png')} className="text-xs focus:bg-white/5 cursor-pointer text-primary">
                                            <Image size={14} className="mr-2" />
                                            <span>Export as PNG</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                {onSettingsClick && (
                                    <DropdownMenuItem onClick={onSettingsClick} className="text-xs focus:bg-white/5 cursor-pointer text-primary">
                                        <Settings size={14} className="mr-2" />
                                        <span>Widget Settings</span>
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                />


                {/* Content */}
                <div id={id} className="flex-1 overflow-auto relative bg-secondary">
                    <WidgetErrorBoundary
                        onError={(error) => console.error(`Widget ${id} (${title}) crashed:`, error)}
                    >
                        {React.isValidElement(children) 
                            ? React.cloneElement(children as React.ReactElement<any>, { 
                                id: id,
                                symbol: displaySymbol,
                                widgetGroup,
                                onDataChange: setInternalData,
                                hideHeader: true
                              }) 
                            : children}
                    </WidgetErrorBoundary>
                </div>

            </div>

            {/* Maximized Portal - renders outside grid DOM */}
            <MaximizedWidgetPortal
                isOpen={isMaximized}
                onClose={() => setIsMaximized(false)}
                title={`${displaySymbol ? `${displaySymbol} - ` : ''}${title}`}
            >
                <WidgetErrorBoundary
                    onError={(error) => console.error(`Maximized Widget ${id} (${title}) crashed:`, error)}
                >
                    {React.isValidElement(children) 
                        ? React.cloneElement(children as React.ReactElement<any>, { 
                            symbol: displaySymbol,
                            widgetGroup,
                            onDataChange: setInternalData
                          }) 
                        : children}
                </WidgetErrorBoundary>
            </MaximizedWidgetPortal>
        </>
    );
}
