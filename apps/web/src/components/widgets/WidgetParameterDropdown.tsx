// Widget Parameter Dropdown - OpenBB-style inline parameter controls in widget headers

'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface ParameterOption {
    value: string;
    label: string;
    description?: string;
}

export interface WidgetParameter {
    id: string;
    label: string;
    currentValue: string;
    options: ParameterOption[];
    onChange: (value: string) => void;
}

interface WidgetParameterDropdownProps {
    parameter: WidgetParameter;
    compact?: boolean;
}

export function WidgetParameterDropdown({
    parameter,
    compact = true
}: WidgetParameterDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const currentOption = parameter.options.find(o => o.value === parameter.currentValue);

    const handleSelect = (value: string) => {
        parameter.onChange(value);
        setIsOpen(false);
    };

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-1 text-gray-400 hover:text-gray-200 
                    hover:bg-white/5 rounded px-1.5 py-0.5 transition-colors
                    ${compact ? 'text-[10px]' : 'text-xs'}
                `}
            >
                <span className="text-gray-500">{parameter.label}:</span>
                <span className="text-gray-300 font-medium">
                    {currentOption?.label || parameter.currentValue}
                </span>
                <ChevronDown size={compact ? 10 : 12} className="text-gray-500" />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] py-1 bg-[#0f1629] border border-[#1e2a3b] rounded-md shadow-xl">
                    {parameter.options.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => handleSelect(option.value)}
                            className={`
                                w-full flex items-center gap-2 px-3 py-1.5 text-left
                                text-xs hover:bg-blue-500/10 transition-colors
                                ${option.value === parameter.currentValue
                                    ? 'text-blue-400 bg-blue-500/5'
                                    : 'text-gray-300'
                                }
                            `}
                        >
                            <span className="flex-1">
                                {option.label}
                                {option.description && (
                                    <span className="block text-[10px] text-gray-500">
                                        {option.description}
                                    </span>
                                )}
                            </span>
                            {option.value === parameter.currentValue && (
                                <Check size={12} className="text-blue-400" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Pre-defined parameter sets for common widget types
// ============================================================================

export const TIMEFRAME_OPTIONS: ParameterOption[] = [
    { value: '1d', label: '1D', description: 'Daily' },
    { value: '1w', label: '1W', description: 'Weekly' },
    { value: '1m', label: '1M', description: 'Monthly' },
    { value: '3m', label: '3M' },
    { value: '6m', label: '6M' },
    { value: '1y', label: '1Y', description: 'Yearly' },
    { value: 'ytd', label: 'YTD', description: 'Year to Date' },
    { value: 'all', label: 'All', description: 'Full History' },
];

export const CHART_TYPE_OPTIONS: ParameterOption[] = [
    { value: 'line', label: 'Line' },
    { value: 'candle', label: 'Candlestick' },
    { value: 'ohlc', label: 'OHLC' },
    { value: 'area', label: 'Area' },
];

export const DATA_SOURCE_OPTIONS: ParameterOption[] = [
    { value: 'VCI', label: 'VCI', description: 'Recommended' },
    { value: 'TCBS', label: 'TCBS', description: 'Legacy' },
    { value: 'SSI', label: 'SSI' },
];

export const PERIOD_OPTIONS: ParameterOption[] = [
    { value: 'annual', label: 'Annual' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'ttm', label: 'TTM', description: 'Trailing 12 Months' },
];

export const INDICATOR_OPTIONS: ParameterOption[] = [
    { value: 'sma20', label: 'SMA 20', description: 'Simple Moving Average' },
    { value: 'sma50', label: 'SMA 50' },
    { value: 'sma200', label: 'SMA 200' },
    { value: 'ema12', label: 'EMA 12', description: 'Exponential Moving Average' },
    { value: 'ema26', label: 'EMA 26' },
    { value: 'rsi', label: 'RSI', description: 'Relative Strength Index' },
    { value: 'macd', label: 'MACD', description: 'Moving Avg Convergence Divergence' },
    { value: 'bb', label: 'Bollinger Bands' },
    { value: 'volume', label: 'Volume', description: 'Trading Volume' },
];

// Helper to create a parameter object
export function createParameter(
    id: string,
    label: string,
    currentValue: string,
    options: ParameterOption[],
    onChange: (value: string) => void
): WidgetParameter {
    return { id, label, currentValue, options, onChange };
}

// ============================================================================
// Multi-Select Parameter Dropdown (for indicators)
// ============================================================================

interface WidgetMultiSelectDropdownProps {
    id: string;
    label: string;
    currentValues: string[];
    options: ParameterOption[];
    onChange: (values: string[]) => void;
    compact?: boolean;
}

export function WidgetMultiSelectDropdown({
    id,
    label,
    currentValues,
    options,
    onChange,
    compact = true
}: WidgetMultiSelectDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const handleToggle = (value: string) => {
        if (currentValues.includes(value)) {
            onChange(currentValues.filter(v => v !== value));
        } else {
            onChange([...currentValues, value]);
        }
    };

    const displayValue = currentValues.length === 0
        ? 'None'
        : currentValues.length <= 2
            ? currentValues.map(v => options.find(o => o.value === v)?.label || v).join(', ')
            : `${currentValues.length} selected`;

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-1 text-gray-400 hover:text-gray-200 
                    hover:bg-white/5 rounded px-1.5 py-0.5 transition-colors
                    ${compact ? 'text-[10px]' : 'text-xs'}
                `}
            >
                <span className="text-gray-500">{label}:</span>
                <span className="text-gray-300 font-medium max-w-[80px] truncate">
                    {displayValue}
                </span>
                <ChevronDown size={compact ? 10 : 12} className="text-gray-500" />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] py-1 bg-[#0f1629] border border-[#1e2a3b] rounded-md shadow-xl max-h-[200px] overflow-y-auto">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => handleToggle(option.value)}
                            className={`
                                w-full flex items-center gap-2 px-3 py-1.5 text-left
                                text-xs hover:bg-blue-500/10 transition-colors
                                ${currentValues.includes(option.value)
                                    ? 'text-blue-400 bg-blue-500/5'
                                    : 'text-gray-300'
                                }
                            `}
                        >
                            {/* Checkbox */}
                            <div className={`
                                w-3.5 h-3.5 rounded border flex items-center justify-center
                                ${currentValues.includes(option.value)
                                    ? 'bg-blue-500 border-blue-500'
                                    : 'border-gray-600'
                                }
                            `}>
                                {currentValues.includes(option.value) && (
                                    <Check size={10} className="text-white" />
                                )}
                            </div>
                            <span className="flex-1">
                                {option.label}
                                {option.description && (
                                    <span className="block text-[10px] text-gray-500">
                                        {option.description}
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

