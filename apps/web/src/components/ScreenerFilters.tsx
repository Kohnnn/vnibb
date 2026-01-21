// Advanced Screener Filters Component

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Filter, X, Save, FolderOpen, RotateCcw } from 'lucide-react';

export interface FilterState {
    // Valuation
    pe_min?: number;
    pe_max?: number;
    pb_min?: number;
    pb_max?: number;
    ps_min?: number;
    ps_max?: number;
    // Fundamentals
    roe_min?: number;
    roa_min?: number;
    debt_to_equity_max?: number;
    // Trading
    market_cap_min?: number;
    market_cap_max?: number;
    volume_min?: number;
}

interface FilterPreset {
    name: string;
    filters: FilterState;
}

interface ScreenerFiltersProps {
    filters: FilterState;
    onFilterChange: (filters: FilterState) => void;
    onClose?: () => void;
}

const PRESET_STORAGE_KEY = 'screener_filter_presets';

// Default presets
const DEFAULT_PRESETS: FilterPreset[] = [
    {
        name: 'Value Stocks',
        filters: { pe_min: 5, pe_max: 15, pb_max: 1.5, roe_min: 10 },
    },
    {
        name: 'Growth Stocks',
        filters: { roe_min: 15, roa_min: 10 },
    },
    {
        name: 'Large Cap',
        filters: { market_cap_min: 10_000_000_000_000 }, // 10 trillion VND
    },
    {
        name: 'High Volume',
        filters: { volume_min: 1_000_000 },
    },
];

function RangeInput({
    label,
    minValue,
    maxValue,
    onMinChange,
    onMaxChange,
    placeholder = { min: 'Min', max: 'Max' },
    step = 0.1,
}: {
    label: string;
    minValue?: number;
    maxValue?: number;
    onMinChange: (value?: number) => void;
    onMaxChange: (value?: number) => void;
    placeholder?: { min: string; max: string };
    step?: number;
}) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    step={step}
                    value={minValue ?? ''}
                    onChange={(e) => onMinChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder={placeholder.min}
                    className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-gray-500">-</span>
                <input
                    type="number"
                    step={step}
                    value={maxValue ?? ''}
                    onChange={(e) => onMaxChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder={placeholder.max}
                    className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                />
            </div>
        </div>
    );
}

function MinInput({
    label,
    value,
    onChange,
    placeholder = 'Min',
    step = 0.1,
    suffix,
}: {
    label: string;
    value?: number;
    onChange: (value?: number) => void;
    placeholder?: string;
    step?: number;
    suffix?: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">{label}</label>
            <div className="flex items-center gap-1">
                <input
                    type="number"
                    step={step}
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder={placeholder}
                    className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                />
                {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
            </div>
        </div>
    );
}

export function ScreenerFilters({ filters, onFilterChange, onClose }: ScreenerFiltersProps) {
    const [presets, setPresets] = useState<FilterPreset[]>([]);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState('');

    // Load presets from localStorage
    useEffect(() => {
        const stored = localStorage.getItem(PRESET_STORAGE_KEY);
        if (stored) {
            try {
                setPresets(JSON.parse(stored));
            } catch {
                setPresets([]);
            }
        }
    }, []);

    const updateFilter = useCallback(
        <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
            onFilterChange({ ...filters, [key]: value });
        },
        [filters, onFilterChange]
    );

    const resetFilters = useCallback(() => {
        onFilterChange({});
    }, [onFilterChange]);

    const savePreset = useCallback(() => {
        if (!presetName.trim()) return;
        
        const newPreset: FilterPreset = {
            name: presetName.trim(),
            filters: { ...filters },
        };
        
        const updated = [...presets.filter(p => p.name !== newPreset.name), newPreset];
        setPresets(updated);
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(updated));
        setPresetName('');
        setShowPresetModal(false);
    }, [presetName, filters, presets]);

    const loadPreset = useCallback(
        (preset: FilterPreset) => {
            onFilterChange(preset.filters);
        },
        [onFilterChange]
    );

    const deletePreset = useCallback(
        (name: string) => {
            const updated = presets.filter(p => p.name !== name);
            setPresets(updated);
            localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(updated));
        },
        [presets]
    );

    const hasActiveFilters = Object.values(filters).some(v => v !== undefined);

    return (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-blue-400" />
                    <span className="text-sm font-medium text-white">Advanced Filters</span>
                    {hasActiveFilters && (
                        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                            Active
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={resetFilters}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                        title="Reset filters"
                    >
                        <RotateCcw size={12} />
                        Reset
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Groups */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Valuation */}
                <div>
                    <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                        Valuation
                    </h4>
                    <div className="space-y-3">
                        <RangeInput
                            label="P/E Ratio"
                            minValue={filters.pe_min}
                            maxValue={filters.pe_max}
                            onMinChange={(v) => updateFilter('pe_min', v)}
                            onMaxChange={(v) => updateFilter('pe_max', v)}
                        />
                        <RangeInput
                            label="P/B Ratio"
                            minValue={filters.pb_min}
                            maxValue={filters.pb_max}
                            onMinChange={(v) => updateFilter('pb_min', v)}
                            onMaxChange={(v) => updateFilter('pb_max', v)}
                        />
                        <RangeInput
                            label="P/S Ratio"
                            minValue={filters.ps_min}
                            maxValue={filters.ps_max}
                            onMinChange={(v) => updateFilter('ps_min', v)}
                            onMaxChange={(v) => updateFilter('ps_max', v)}
                        />
                    </div>
                </div>

                {/* Fundamentals */}
                <div>
                    <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                        Fundamentals
                    </h4>
                    <div className="space-y-3">
                        <MinInput
                            label="ROE Min"
                            value={filters.roe_min}
                            onChange={(v) => updateFilter('roe_min', v)}
                            placeholder="e.g. 15"
                            suffix="%"
                        />
                        <MinInput
                            label="ROA Min"
                            value={filters.roa_min}
                            onChange={(v) => updateFilter('roa_min', v)}
                            placeholder="e.g. 10"
                            suffix="%"
                        />
                        <MinInput
                            label="D/E Max"
                            value={filters.debt_to_equity_max}
                            onChange={(v) => updateFilter('debt_to_equity_max', v)}
                            placeholder="e.g. 1.5"
                        />
                    </div>
                </div>

                {/* Trading */}
                <div>
                    <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                        Trading
                    </h4>
                    <div className="space-y-3">
                        <RangeInput
                            label="Market Cap (VND bn)"
                            minValue={filters.market_cap_min ? filters.market_cap_min / 1e9 : undefined}
                            maxValue={filters.market_cap_max ? filters.market_cap_max / 1e9 : undefined}
                            onMinChange={(v) => updateFilter('market_cap_min', v ? v * 1e9 : undefined)}
                            onMaxChange={(v) => updateFilter('market_cap_max', v ? v * 1e9 : undefined)}
                            step={1}
                        />
                        <MinInput
                            label="Volume Min"
                            value={filters.volume_min ? filters.volume_min / 1000 : undefined}
                            onChange={(v) => updateFilter('volume_min', v ? v * 1000 : undefined)}
                            placeholder="e.g. 100"
                            suffix="K"
                            step={10}
                        />
                    </div>
                </div>
            </div>

            {/* Presets */}
            <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Quick Presets
                    </span>
                    <button
                        onClick={() => setShowPresetModal(true)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        <Save size={12} />
                        Save Current
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {DEFAULT_PRESETS.map((preset) => (
                        <button
                            key={preset.name}
                            onClick={() => loadPreset(preset)}
                            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                        >
                            {preset.name}
                        </button>
                    ))}
                    {presets.map((preset) => (
                        <div key={preset.name} className="flex items-center gap-1">
                            <button
                                onClick={() => loadPreset(preset)}
                                className="px-3 py-1.5 text-xs bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 rounded-l transition-colors"
                            >
                                {preset.name}
                            </button>
                            <button
                                onClick={() => deletePreset(preset.name)}
                                className="px-1.5 py-1.5 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-r transition-colors"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Save Preset Modal */}
            {showPresetModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-80">
                        <h3 className="text-sm font-medium text-white mb-3">Save Filter Preset</h3>
                        <input
                            type="text"
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder="Preset name"
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-3"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowPresetModal(false)}
                                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={savePreset}
                                disabled={!presetName.trim()}
                                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
