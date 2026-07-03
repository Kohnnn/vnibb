// Widget Interface Contract - Formal types for widget system
// This provides type safety for the widget ecosystem

import type { WidgetType, WidgetConfig, WidgetLayout } from '@/types/dashboard';

// ============================================================================
// Base Widget Interface
// ============================================================================

/**
 * Base interface for all widgets
 */
export interface BaseWidgetProps {
  /** Widget instance ID */
  id: string;
  /** Current stock symbol */
  symbol: string;
  /** Widget group for sync */
  widgetGroup?: WidgetGroupId;
  /** Callback when widget data changes */
  onDataChange?: (data: unknown) => void;
}

/**
 * Widget instance metadata
 */
export interface WidgetInstanceProps {
  id: string;
  type: WidgetType;
  tabId: string;
  dashboardId: string;
  syncGroupId?: number;
  widgetGroup?: WidgetGroupId;
  config: WidgetConfig;
  layout: WidgetLayout;
}

// ============================================================================
// Widget Group Types
// ============================================================================

export type WidgetGroupId = 'A' | 'B' | 'C' | 'D' | 'global';

// ============================================================================
// Export Types
// ============================================================================

/**
 * Supported export formats
 */
export type ExportFormat = 'csv' | 'json' | 'png';

/**
 * Export metadata for provenance tracking
 */
export interface ExportProvenance {
  widgetId: string;
  widgetType: WidgetType;
  symbol?: string;
  timestamp: string;
  filters?: Record<string, unknown>;
}

/**
 * Export data structure
 */
export interface ExportableData {
  headers?: string[];
  rows?: Record<string, unknown>[];
  chart?: HTMLCanvasElement | HTMLImageElement;
  filename?: string;
}

// ============================================================================
// Widget Runtime Types
// ============================================================================

/**
 * Widget runtime layout hints
 */
export interface WidgetRuntimeLayoutHint {
  compactHeight?: number;
  empty?: boolean;
}

/**
 * Widget runtime payload wrapper
 */
export interface WidgetRuntimePayload<T = unknown> {
  __widgetRuntime?: {
    layoutHint?: WidgetRuntimeLayoutHint;
    provenance?: Partial<ExportProvenance>;
    data?: T;
  };
}

/**
 * Widget export context
 */
export interface WidgetExportContext {
  format: ExportFormat;
  filename: string;
  provenance: ExportProvenance;
}

// ============================================================================
// Widget Wrapper Types
// ============================================================================

/**
 * Multi-select parameter interface
 */
export interface WidgetMultiSelectParam {
  id: string;
  label: string;
  currentValues: string[];
  options: ParameterOption[];
  onChange: (values: string[]) => void;
}

/**
 * Widget parameter definition
 */
export interface WidgetParameter {
  id: string;
  label: string;
  type: 'select' | 'multiselect' | 'text' | 'number' | 'date';
  value: string | string[] | number | boolean;
  options?: ParameterOption[];
  onChange: (value: string | string[] | number | boolean) => void;
}

/**
 * Parameter option
 */
export interface ParameterOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Widget wrapper props
 */
export interface WidgetWrapperProps {
  id: string;
  title: string;
  widgetType: WidgetType;
  children: React.ReactNode;
  symbol?: string;
  tabId: string;
  dashboardId: string;
  syncGroupId?: number;
  widgetGroup?: WidgetGroupId;
  isEditing?: boolean;
  isCollapsed?: boolean;
  showTickerSelector?: boolean;
  showGroupLabels?: boolean;
  parameters?: WidgetParameter[];
  multiSelectParams?: WidgetMultiSelectParam[];
  data?: ExportableData;
  onRemove?: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onSettings?: () => void;
  onSymbolChange?: (symbol: string) => void;
  onExport?: (format: ExportFormat) => void;
  className?: string;
}

// ============================================================================
// Widget Health Types
// ============================================================================

/**
 * Widget health status
 */
export type WidgetHealthStatus = 'healthy' | 'stale' | 'error' | 'unknown';

/**
 * Widget health metadata
 */
export interface WidgetHealth {
  status: WidgetHealthStatus;
  lastUpdated?: string;
  error?: string;
  source?: string;
}

// ============================================================================
// Type Guards & Utilities
// ============================================================================

/**
 * Check if data is exportable
 */
export function isExportableData(data: unknown): data is ExportableData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.rows) || obj.chart !== undefined;
}

/**
 * Get export filename
 */
export function getExportFilename(
  widgetType: WidgetType,
  symbol?: string,
  format: ExportFormat = 'csv'
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const symbolPart = symbol ? `_${symbol}` : '';
  return `${widgetType}${symbolPart}_${timestamp}.${format}`;
}
