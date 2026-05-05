/**
 * Widget Header Component
 * 
 * Standard header for all VNIBB widgets following OpenBB patterns
 * Features:
 * - Title with optional subtitle
 * - Symbol selector for local control
 * - Period toggles (FY/QTR/TTM)
 * - View mode toggles (Chart/Table)
 * - Action menu (Refresh, Maximize, Export, Settings)
 */

import React from 'react';
import {
    RefreshCw,
    Maximize2,
    Download,
    Settings,
    X,
    TrendingUp,
    Table2
} from 'lucide-react';

export interface WidgetHeaderProps {
    title: string;
    subtitle?: string;
    symbol?: string;
    onSymbolChange?: (symbol: string) => void;
    period?: 'year' | 'quarter' | 'ttm';
    onPeriodChange?: (period: 'year' | 'quarter' | 'ttm') => void;
    viewMode?: 'chart' | 'table';
    onViewModeChange?: (mode: 'chart' | 'table') => void;
    onRefresh?: () => void;
    onMaximize?: () => void;
    onExport?: () => void;
    onSettings?: () => void;
    onClose?: () => void;
    showSymbolSelector?: boolean;
    showPeriodToggle?: boolean;
    showViewToggle?: boolean;
    isRefreshing?: boolean;
}

export const WidgetHeader: React.FC<WidgetHeaderProps> = ({
    title,
    subtitle,
    symbol,
    onSymbolChange,
    period = 'year',
    onPeriodChange,
    viewMode = 'chart',
    onViewModeChange,
    onRefresh,
    onMaximize,
    onExport,
    onSettings,
    onClose,
    showSymbolSelector = false,
    showPeriodToggle = false,
    showViewToggle = false,
    isRefreshing = false,
}) => {
    return (
        <div className="widget-header">
            {/* Left Section: Title & Controls */}
            <div className="widget-header__left">
                <div className="widget-header__title-group">
                    <h3 className="widget-header__title">{title}</h3>
                    {subtitle && <span className="widget-header__subtitle">{subtitle}</span>}
                </div>

                {/* Symbol Selector */}
                {showSymbolSelector && (
                    <div className="widget-header__symbol">
                        <input
                            type="text"
                            value={symbol || ''}
                            onChange={(e) => onSymbolChange?.(e.target.value.toUpperCase())}
                            placeholder="Symbol..."
                            className="widget-header__symbol-input"
                            maxLength={5}
                        />
                    </div>
                )}

                {/* Period Toggle */}
                {showPeriodToggle && (
                    <div className="widget-header__toggle-group">
                        <button
                            className={`widget-header__toggle ${period === 'year' ? 'active' : ''}`}
                            onClick={() => onPeriodChange?.('year')}
                        >
                            FY
                        </button>
                        <button
                            className={`widget-header__toggle ${period === 'quarter' ? 'active' : ''}`}
                            onClick={() => onPeriodChange?.('quarter')}
                        >
                            QTR
                        </button>
                        <button
                            className={`widget-header__toggle ${period === 'ttm' ? 'active' : ''}`}
                            onClick={() => onPeriodChange?.('ttm')}
                        >
                            TTM
                        </button>
                    </div>
                )}

                {/* View Mode Toggle */}
                {showViewToggle && (
                    <div className="widget-header__toggle-group">
                        <button
                            className={`widget-header__toggle ${viewMode === 'chart' ? 'active' : ''}`}
                            onClick={() => onViewModeChange?.('chart')}
                            title="Chart View"
                        >
                            <TrendingUp size={14} />
                        </button>
                        <button
                            className={`widget-header__toggle ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => onViewModeChange?.('table')}
                            title="Table View"
                        >
                            <Table2 size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* Right Section: Actions */}
            <div className="widget-header__actions">
                {onRefresh && (
                    <button
                        className="widget-header__action"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        title="Refresh"
                    >
                        <RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} />
                    </button>
                )}
                {onMaximize && (
                    <button
                        className="widget-header__action"
                        onClick={onMaximize}
                        title="Maximize"
                    >
                        <Maximize2 size={14} />
                    </button>
                )}
                {onExport && (
                    <button
                        className="widget-header__action"
                        onClick={onExport}
                        title="Export"
                    >
                        <Download size={14} />
                    </button>
                )}
                {onSettings && (
                    <button
                        className="widget-header__action"
                        onClick={onSettings}
                        title="Settings"
                    >
                        <Settings size={14} />
                    </button>
                )}
                {onClose && (
                    <button
                        className="widget-header__action"
                        onClick={onClose}
                        title="Close"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>
        </div>
    );
};
