// Filter Builder Panel for Advanced Stock Screener
// Supports all 84 TCBS metrics with AND/OR logic
'use client';

import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, Settings2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';

export interface FilterCondition {
    id: string;
    field: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'between' | 'in';
    value: number | number[] | string[];
    enabled: boolean;
}

export interface FilterGroup {
    logic: 'AND' | 'OR';
    conditions: FilterCondition[];
}

interface FilterBuilderPanelProps {
    filterGroup: FilterGroup;
    onFilterChange: (group: FilterGroup) => void;
    onClose?: () => void;
}

interface MetricDefinition {
    id: string;
    name: string;
    type: 'number' | 'percent' | 'currency' | 'string';
    multiplier?: number; // For currency fields (e.g., market_cap in billions)
}

// All 84 TCBS metrics organized by category
const METRIC_GROUPS: { name: string; metrics: MetricDefinition[] }[] = [
    {
        name: 'Identification',
        metrics: [
            { id: 'ticker', name: 'Symbol', type: 'string' },
            { id: 'exchange', name: 'Exchange', type: 'string' },
            { id: 'industry_name', name: 'Industry', type: 'string' },
        ]
    },
    {
        name: 'Price & Volume',
        metrics: [
            { id: 'price', name: 'Price (VND)', type: 'number' },
            { id: 'change_1d', name: 'Change 1D (%)', type: 'percent' },
            { id: 'volume', name: 'Volume', type: 'number' },
            { id: 'rs_rating', name: 'RS Rating (1-99)', type: 'number' },
            { id: 'rs_rank', name: 'RS Rank', type: 'number' },
            { id: 'market_cap', name: 'Market Cap (VND bn)', type: 'currency', multiplier: 1e9 },
            { id: 'shares_outstanding', name: 'Shares Outstanding (mn)', type: 'number', multiplier: 1e6 },
        ]
    },
    {
        name: 'Valuation Ratios',
        metrics: [
            { id: 'pe', name: 'P/E Ratio', type: 'number' },
            { id: 'pb', name: 'P/B Ratio', type: 'number' },
            { id: 'ps', name: 'P/S Ratio', type: 'number' },
            { id: 'ev_ebitda', name: 'EV/EBITDA', type: 'number' },
            { id: 'ebitda_on_stock', name: 'EBITDA per Share', type: 'number' },
            { id: 'price_to_cash_flow', name: 'P/CF Ratio', type: 'number' },
        ]
    },
    {
        name: 'Profitability',
        metrics: [
            { id: 'roe', name: 'ROE (%)', type: 'percent' },
            { id: 'roa', name: 'ROA (%)', type: 'percent' },
            { id: 'roic', name: 'ROIC (%)', type: 'percent' },
            { id: 'gross_margin', name: 'Gross Margin (%)', type: 'percent' },
            { id: 'operating_margin', name: 'Operating Margin (%)', type: 'percent' },
            { id: 'net_margin', name: 'Net Margin (%)', type: 'percent' },
            { id: 'ebit_on_revenue', name: 'EBIT/Revenue (%)', type: 'percent' },
            { id: 'pre_tax_on_ebit', name: 'Pre-Tax/EBIT (%)', type: 'percent' },
            { id: 'post_tax_on_pre_tax', name: 'Post-Tax/Pre-Tax (%)', type: 'percent' },
        ]
    },
    {
        name: 'Per Share Data',
        metrics: [
            { id: 'eps', name: 'EPS (VND)', type: 'number' },
            { id: 'bvps', name: 'Book Value per Share', type: 'number' },
            { id: 'eps_change', name: 'EPS Change YoY (%)', type: 'percent' },
            { id: 'bvps_change', name: 'BVPS Change YoY (%)', type: 'percent' },
            { id: 'ebitda_on_stock_change', name: 'EBITDA/Share Change (%)', type: 'percent' },
        ]
    },
    {
        name: 'Growth Metrics',
        metrics: [
            { id: 'revenue_growth', name: 'Revenue Growth YoY (%)', type: 'percent' },
            { id: 'earnings_growth', name: 'Earnings Growth YoY (%)', type: 'percent' },
            { id: 'net_profit_growth', name: 'Net Profit Growth YoY (%)', type: 'percent' },
        ]
    },
    {
        name: 'Dividend',
        metrics: [
            { id: 'dividend_yield', name: 'Dividend Yield (%)', type: 'percent' },
        ]
    },
    {
        name: 'Liquidity Ratios',
        metrics: [
            { id: 'current_ratio', name: 'Current Ratio', type: 'number' },
            { id: 'quick_ratio', name: 'Quick Ratio', type: 'number' },
            { id: 'cash_ratio', name: 'Cash Ratio', type: 'number' },
            { id: 'days_receivable', name: 'Days Receivable', type: 'number' },
            { id: 'days_payable', name: 'Days Payable', type: 'number' },
            { id: 'avg_collection_period', name: 'Avg Collection Period', type: 'number' },
            { id: 'cash_conversion_cycle', name: 'Cash Conversion Cycle', type: 'number' },
        ]
    },
    {
        name: 'Capital Structure & Debt',
        metrics: [
            { id: 'debt_to_equity', name: 'Debt to Equity', type: 'number' },
            { id: 'debt_to_asset', name: 'Debt to Asset', type: 'number' },
            { id: 'debt_to_ebitda', name: 'Debt/EBITDA', type: 'number' },
            { id: 'leverage', name: 'Leverage Ratio', type: 'number' },
            { id: 'asset_to_equity', name: 'Asset to Equity', type: 'number' },
            { id: 'equity_on_total_asset', name: 'Equity/Total Asset (%)', type: 'percent' },
            { id: 'equity_on_liability', name: 'Equity/Liability', type: 'number' },
            { id: 'asset_on_equity', name: 'Asset/Equity', type: 'number' },
            { id: 'payable_on_equity', name: 'Payable/Equity', type: 'number' },
            { id: 'capital_balance', name: 'Capital Balance', type: 'number' },
            { id: 'short_on_long_debt', name: 'Short/Long Debt', type: 'number' },
            { id: 'interest_coverage', name: 'Interest Coverage', type: 'number' },
        ]
    },
    {
        name: 'Cash Metrics',
        metrics: [
            { id: 'cash_on_equity', name: 'Cash/Equity', type: 'number' },
            { id: 'cash_on_capitalize', name: 'Cash/Capitalization', type: 'number' },
        ]
    },
    {
        name: 'Efficiency Metrics',
        metrics: [
            { id: 'asset_turnover', name: 'Asset Turnover', type: 'number' },
            { id: 'fixed_asset_turnover', name: 'Fixed Asset Turnover', type: 'number' },
            { id: 'revenue_on_asset', name: 'Revenue/Asset', type: 'number' },
            { id: 'revenue_on_work_capital', name: 'Revenue/Working Capital', type: 'number' },
            { id: 'capex_on_fixed_asset', name: 'CapEx/Fixed Asset', type: 'number' },
        ]
    },
    {
        name: 'Ownership',
        metrics: [
            { id: 'foreign_ownership', name: 'Foreign Ownership (%)', type: 'percent' },
            { id: 'state_ownership', name: 'State Ownership (%)', type: 'percent' },
        ]
    },
    {
        name: 'Time Period',
        metrics: [
            { id: 'year', name: 'Fiscal Year', type: 'number' },
            { id: 'quarter', name: 'Fiscal Quarter', type: 'number' },
        ]
    }
];

// Flatten metrics for quick lookup
const ALL_METRICS = METRIC_GROUPS.flatMap(g => g.metrics);
const METRIC_MAP = new Map(ALL_METRICS.map(m => [m.id, m]));

const OPERATORS = [
    { id: 'gt', name: '> Greater Than', symbol: '>' },
    { id: 'gte', name: '>= Greater or Equal', symbol: '≥' },
    { id: 'lt', name: '< Less Than', symbol: '<' },
    { id: 'lte', name: '<= Less or Equal', symbol: '≤' },
    { id: 'eq', name: '= Equals', symbol: '=' },
    { id: 'between', name: 'Between', symbol: '↔' },
    { id: 'in', name: 'In List', symbol: '∈' },
];

export function FilterBuilderPanel({ filterGroup, onFilterChange, onClose }: FilterBuilderPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');

    // Filter metrics by search query
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return METRIC_GROUPS;
        const q = searchQuery.toLowerCase();
        return METRIC_GROUPS.map(group => ({
            ...group,
            metrics: group.metrics.filter(m =>
                m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
            )
        })).filter(g => g.metrics.length > 0);
    }, [searchQuery]);

    const addCondition = useCallback(() => {
        const newCondition: FilterCondition = {
            id: crypto.randomUUID(),
            field: 'pe',
            operator: 'lt',
            value: 20,
            enabled: true,
        };
        onFilterChange({
            ...filterGroup,
            conditions: [...filterGroup.conditions, newCondition]
        });
    }, [filterGroup, onFilterChange]);

    const removeCondition = useCallback((id: string) => {
        onFilterChange({
            ...filterGroup,
            conditions: filterGroup.conditions.filter(c => c.id !== id)
        });
    }, [filterGroup, onFilterChange]);

    const updateCondition = useCallback((id: string, updates: Partial<FilterCondition>) => {
        onFilterChange({
            ...filterGroup,
            conditions: filterGroup.conditions.map(c => {
                if (c.id !== id) return c;
                const updated = { ...c, ...updates };
                // Reset value when operator changes to between/in
                if (updates.operator === 'between' && !Array.isArray(c.value)) {
                    updated.value = [0, 100];
                } else if (updates.operator === 'in' && !Array.isArray(c.value)) {
                    updated.value = [];
                } else if (updates.operator && updates.operator !== 'between' && updates.operator !== 'in' && Array.isArray(c.value)) {
                    updated.value = 0;
                }
                return updated;
            })
        });
    }, [filterGroup, onFilterChange]);

    const handleLogicChange = useCallback((logic: 'AND' | 'OR') => {
        onFilterChange({ ...filterGroup, logic });
    }, [filterGroup, onFilterChange]);

    const getMetricLabel = (fieldId: string): string => {
        return METRIC_MAP.get(fieldId)?.name || fieldId;
    };

    return (
        <div className="flex flex-col gap-4 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-5 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600/20 p-2 rounded-lg">
                        <Settings2 className="text-blue-500" size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Advanced Filter Builder</h3>
                        <p className="text-xs text-gray-500">84 metrics available • Combine with AND/OR logic</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#1e1e1e] rounded-lg p-0.5">
                        <button
                            onClick={() => handleLogicChange('AND')}
                            className={`px-3 py-1 text-xs rounded-md transition-all ${filterGroup.logic === 'AND'
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            AND
                        </button>
                        <button
                            onClick={() => handleLogicChange('OR')}
                            className={`px-3 py-1 text-xs rounded-md transition-all ${filterGroup.logic === 'OR'
                                ? 'bg-orange-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            OR
                        </button>
                    </div>
                    {onClose && (
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-gray-400 hover:text-white">
                            <X size={18} />
                        </Button>
                    )}
                </div>
            </div>

            {/* Conditions List */}
            <div className="space-y-3 min-h-[100px] max-h-[400px] overflow-y-auto px-1">
                {filterGroup.conditions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-600 border-2 border-dashed border-[#1e1e1e] rounded-xl">
                        <p className="text-sm">No conditions defined</p>
                        <p className="text-xs mt-1">Click "Add Condition" to start filtering</p>
                    </div>
                ) : (
                    filterGroup.conditions.map((cond, index) => (
                        <div key={cond.id} className="flex items-center gap-3 bg-[#161616] border border-[#222] hover:border-[#333] p-3 rounded-lg group transition-all">
                            {/* Logic connector */}
                            {index > 0 && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${filterGroup.logic === 'AND' ? 'bg-blue-600/20 text-blue-400' : 'bg-orange-600/20 text-orange-400'}`}>
                                    {filterGroup.logic}
                                </span>
                            )}

                            <div className="flex items-center gap-3 flex-1">
                                {/* Metric Selector */}
                                <div className="w-1/3 min-w-[180px]">
                                    <Select
                                        value={cond.field}
                                        onValueChange={(val: string) => updateCondition(cond.id, { field: val })}
                                    >
                                        <SelectTrigger className="bg-[#0a0a0a] border-[#222] text-xs h-9">
                                            <SelectValue>{getMetricLabel(cond.field)}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent className="bg-[#0a0a0a] border-[#222] max-h-[300px]">
                                            {/* Search input */}
                                            <div className="p-2 border-b border-[#222]">
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                                                    <input
                                                        type="text"
                                                        placeholder="Search metrics..."
                                                        value={searchQuery}
                                                        onChange={(e) => setSearchQuery(e.target.value)}
                                                        className="w-full bg-[#161616] border border-[#222] rounded pl-7 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>
                                            {filteredGroups.map(group => (
                                                <div key={group.name} className="px-2 py-1.5">
                                                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 px-2 sticky top-0 bg-[#0a0a0a]">
                                                        {group.name}
                                                    </div>
                                                    {group.metrics.map(metric => (
                                                        <SelectItem key={metric.id} value={metric.id} className="text-xs">
                                                            {metric.name}
                                                        </SelectItem>
                                                    ))}
                                                </div>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Operator Selector */}
                                <div className="w-1/5 min-w-[100px]">
                                    <Select
                                        value={cond.operator}
                                        onValueChange={(val: FilterCondition['operator']) => updateCondition(cond.id, { operator: val })}
                                    >
                                        <SelectTrigger className="bg-[#0a0a0a] border-[#222] text-xs h-9 text-gray-300">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-[#0a0a0a] border-[#222]">
                                            {OPERATORS.map(op => (
                                                <SelectItem key={op.id} value={op.id} className="text-xs">
                                                    <span className="font-mono mr-2 text-blue-400">{op.symbol}</span>
                                                    {op.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Value Input */}
                                <div className="flex-1 min-w-[120px]">
                                    {cond.operator === 'between' ? (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={String(Array.isArray(cond.value) ? cond.value[0] : 0)}
                                                onChange={(e) => {
                                                    const minVal = parseFloat(e.target.value) || 0;
                                                    const maxVal = Array.isArray(cond.value) && typeof cond.value[1] === 'number' ? cond.value[1] : 100;
                                                    updateCondition(cond.id, { value: [minVal, maxVal] as number[] });
                                                }}
                                                className="bg-[#0a0a0a] border-[#222] h-9 text-xs"
                                                placeholder="Min"
                                            />
                                            <span className="text-gray-600 text-xs">to</span>
                                            <Input
                                                type="number"
                                                value={String(Array.isArray(cond.value) ? cond.value[1] : 100)}
                                                onChange={(e) => {
                                                    const minVal = Array.isArray(cond.value) && typeof cond.value[0] === 'number' ? cond.value[0] : 0;
                                                    const maxVal = parseFloat(e.target.value) || 100;
                                                    updateCondition(cond.id, { value: [minVal, maxVal] as number[] });
                                                }}
                                                className="bg-[#0a0a0a] border-[#222] h-9 text-xs"
                                                placeholder="Max"
                                            />
                                        </div>
                                    ) : cond.operator === 'in' ? (
                                        <Input
                                            type="text"
                                            value={Array.isArray(cond.value) ? cond.value.join(', ') : ''}
                                            onChange={(e) => updateCondition(cond.id, {
                                                value: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                            })}
                                            className="bg-[#0a0a0a] border-[#222] h-9 text-xs"
                                            placeholder="comma, separated, values"
                                        />
                                    ) : (
                                        <Input
                                            type="number"
                                            value={typeof cond.value === 'number' ? cond.value : 0}
                                            onChange={(e) => updateCondition(cond.id, { value: parseFloat(e.target.value) || 0 })}
                                            className="bg-[#0a0a0a] border-[#222] h-9 text-xs"
                                            placeholder="Value"
                                        />
                                    )}
                                </div>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeCondition(cond.id)}
                                className="h-8 w-8 text-gray-600 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={16} />
                            </Button>
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-4 border-t border-[#1e1e1e]">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={addCondition}
                    className="bg-transparent border-[#222] hover:bg-[#1e1e1e] text-xs h-9 flex items-center gap-2"
                >
                    <Plus size={14} />
                    Add Condition
                </Button>

                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                        {filterGroup.conditions.length} condition{filterGroup.conditions.length !== 1 ? 's' : ''}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onFilterChange({ logic: 'AND', conditions: [] })}
                        className="text-xs text-gray-500 hover:text-white h-9"
                    >
                        Clear All
                    </Button>
                    <Button
                        size="sm"
                        onClick={onClose}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-9 shadow-lg shadow-blue-600/20"
                    >
                        Apply Filters
                    </Button>
                </div>
            </div>
        </div>
    );
}

// Export metrics for use in other components
export { METRIC_GROUPS, ALL_METRICS, METRIC_MAP };
