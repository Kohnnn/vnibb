// Template Manager for Advanced Stock Screener
'use client';

import { useState, useEffect, useRef } from 'react';
import { Save, FolderOpen, Trash2, Download, Upload, ChevronDown, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { FilterGroup } from './FilterBuilderPanel';

export interface ScreenerTemplate {
    id: string;
    name: string;
    filters: FilterGroup;
    columns: string[]; // List of visible column IDs in order
    createdAt: string;
}

interface TemplateSelectorProps {
    currentFilters: FilterGroup;
    currentColumns: string[];
    onLoadTemplate: (template: ScreenerTemplate) => void;
}

const STORAGE_KEY = 'vnibb-screener-templates-v1';

// Built-in preset templates
const PRESET_TEMPLATES: Omit<ScreenerTemplate, 'id' | 'createdAt'>[] = [
    {
        name: 'Value Stocks',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'pe', operator: 'lt', value: 15, enabled: true },
                { id: '2', field: 'pb', operator: 'lt', value: 1.5, enabled: true },
                { id: '3', field: 'roe', operator: 'gte', value: 10, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'pe', 'pb', 'roe', 'dividend_yield', 'market_cap']
    },
    {
        name: 'Growth Stocks',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'revenue_growth', operator: 'gte', value: 15, enabled: true },
                { id: '2', field: 'earnings_growth', operator: 'gte', value: 15, enabled: true },
                { id: '3', field: 'roe', operator: 'gte', value: 15, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'revenue_growth', 'earnings_growth', 'roe', 'pe', 'market_cap']
    },
    {
        name: 'Dividend Champions',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'dividend_yield', operator: 'gte', value: 5, enabled: true },
                { id: '2', field: 'debt_to_equity', operator: 'lt', value: 1, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'dividend_yield', 'pe', 'debt_to_equity', 'roe', 'market_cap']
    },
    {
        name: 'Large Cap Leaders',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'market_cap', operator: 'gte', value: 10000000000000, enabled: true },
                { id: '2', field: 'roe', operator: 'gte', value: 12, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'market_cap', 'pe', 'roe', 'net_margin', 'volume']
    },
    {
        name: 'High RS Stocks',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'rs_rating', operator: 'gte', value: 80, enabled: true },
                { id: '2', field: 'market_cap', operator: 'gte', value: 1000000000000, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'rs_rating', 'change_1d', 'volume', 'market_cap', 'roe']
    },
    {
        name: 'RS Momentum Gainers',
        filters: {
            logic: 'AND',
            conditions: [
                { id: '1', field: 'rs_rating', operator: 'gte', value: 70, enabled: true },
                { id: '2', field: 'change_1d', operator: 'gt', value: 0, enabled: true },
                { id: '3', field: 'volume', operator: 'gte', value: 100000, enabled: true },
            ]
        },
        columns: ['ticker', 'price', 'rs_rating', 'change_1d', 'revenue_growth', 'volume', 'market_cap']
    },
];


export function TemplateSelector({ currentFilters, currentColumns, onLoadTemplate }: TemplateSelectorProps) {
    const [templates, setTemplates] = useState<ScreenerTemplate[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [newName, setNewName] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setTemplates(JSON.parse(stored));
            } catch (e) {
                console.error("Failed to load templates", e);
            }
        }
    }, []);

    const saveTemplate = () => {
        if (!newName.trim()) return;

        const newTemplate: ScreenerTemplate = {
            id: crypto.randomUUID(),
            name: newName.trim(),
            filters: currentFilters,
            columns: currentColumns,
            createdAt: new Date().toISOString(),
        };

        // Check for duplicate names and update if exists
        const existingIndex = templates.findIndex(t => t.name.toLowerCase() === newName.trim().toLowerCase());
        let updated: ScreenerTemplate[];
        if (existingIndex >= 0) {
            updated = [...templates];
            updated[existingIndex] = newTemplate;
        } else {
            updated = [...templates, newTemplate];
        }

        setTemplates(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setNewName('');
        setIsSaving(false);
    };

    const deleteTemplate = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = templates.filter(t => t.id !== id);
        setTemplates(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    const exportTemplates = () => {
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            templates: templates,
        };
        const data = JSON.stringify(exportData, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vnibb-screener-templates-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importTemplates = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImportError(null);
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = event.target?.result as string;
                const parsed = JSON.parse(content);

                // Handle both old format (array) and new format (object with templates)
                let importedTemplates: ScreenerTemplate[];
                if (Array.isArray(parsed)) {
                    importedTemplates = parsed;
                } else if (parsed.templates && Array.isArray(parsed.templates)) {
                    importedTemplates = parsed.templates;
                } else {
                    throw new Error('Invalid template format');
                }

                // Validate structure
                for (const t of importedTemplates) {
                    if (!t.name || !t.filters || !t.columns) {
                        throw new Error(`Invalid template: ${t.name || 'unnamed'}`);
                    }
                }

                // Merge with existing (update duplicates by name)
                const merged = [...templates];
                for (const imported of importedTemplates) {
                    const existingIndex = merged.findIndex(t => t.name.toLowerCase() === imported.name.toLowerCase());
                    if (existingIndex >= 0) {
                        merged[existingIndex] = { ...imported, id: merged[existingIndex].id };
                    } else {
                        merged.push({ ...imported, id: imported.id || crypto.randomUUID() });
                    }
                }

                setTemplates(merged);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch (err) {
                setImportError(err instanceof Error ? err.message : 'Failed to import templates');
            }
        };
        reader.readAsText(file);

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const loadPreset = (preset: Omit<ScreenerTemplate, 'id' | 'createdAt'>) => {
        const template: ScreenerTemplate = {
            ...preset,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
        };
        onLoadTemplate(template);
        setIsSaving(false);
    };

    return (
        <div className="flex items-center gap-2">
            <div className="relative">
                <Button
                    variant="outline"
                    size="sm"
                    className="bg-[#161616] border-[#222] text-xs h-8 flex items-center gap-2 text-gray-300 hover:text-white"
                    onClick={() => setIsSaving(!isSaving)}
                >
                    <FolderOpen size={14} className="text-amber-500" />
                    Templates
                    <ChevronDown size={12} className="text-gray-500" />
                </Button>
            </div>

            {isSaving && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-6 shadow-2xl w-96 max-w-full">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <Save size={20} className="text-blue-500" />
                            Screener Templates
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 mb-1.5 block">Save current view as</label>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Template name (e.g. High Yield Growth)"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        className="bg-[#161616] border-[#222] h-10 text-sm"
                                    />
                                    <Button onClick={saveTemplate} className="bg-blue-600 hover:bg-blue-500 h-10 px-4">
                                        <Save size={16} />
                                    </Button>
                                </div>
                            </div>

                            <div className="border-t border-[#1e1e1e] pt-4">
                                <label className="text-xs text-gray-500 mb-2 block">Saved Templates</label>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {templates.length === 0 ? (
                                        <p className="text-xs text-gray-600 italic py-4 text-center">No saved templates</p>
                                    ) : (
                                        templates.map(t => (
                                            <div
                                                key={t.id}
                                                onClick={() => {
                                                    onLoadTemplate(t);
                                                    setIsSaving(false);
                                                }}
                                                className="flex items-center justify-between p-3 bg-[#161616] border border-[#222] hover:border-blue-500/50 rounded-lg group cursor-pointer transition-all"
                                            >
                                                <div>
                                                    <div className="text-sm font-medium text-gray-200 group-hover:text-blue-400">{t.name}</div>
                                                    <div className="text-[10px] text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) => deleteTemplate(t.id, e)}
                                                    className="h-8 w-8 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between pt-2">
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={exportTemplates} className="text-xs border-[#222] text-gray-400">
                                        <Download size={14} className="mr-2" /> Export
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="text-xs border-[#222] text-gray-400"
                                    >
                                        <Upload size={14} className="mr-2" /> Import
                                    </Button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".json"
                                        onChange={importTemplates}
                                        className="hidden"
                                    />
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setIsSaving(false)} className="text-xs text-gray-500">
                                    Close
                                </Button>
                            </div>

                            {importError && (
                                <div className="flex items-center gap-2 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400 mt-2">
                                    <AlertCircle size={14} />
                                    {importError}
                                </div>
                            )}

                            {/* Preset Templates */}
                            <div className="border-t border-[#1e1e1e] pt-4 mt-2">
                                <label className="text-xs text-gray-500 mb-2 block">Quick Presets</label>
                                <div className="flex flex-wrap gap-2">
                                    {PRESET_TEMPLATES.map(preset => (
                                        <button
                                            key={preset.name}
                                            onClick={() => loadPreset(preset)}
                                            className="px-3 py-1.5 text-xs bg-[#1e1e1e] hover:bg-blue-600/20 text-gray-400 hover:text-blue-400 rounded transition-colors"
                                        >
                                            {preset.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
