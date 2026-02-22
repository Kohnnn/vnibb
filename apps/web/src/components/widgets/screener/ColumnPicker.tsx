// Column Picker with reordering for Advanced Stock Screener
'use client';

import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { GripVertical, Eye, EyeOff, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface Column {
    id: string;
    label: string;
    visible: boolean;
}

interface ColumnPickerProps {
    columns: Column[];
    onColumnsChange: (columns: Column[]) => void;
    onReset: () => void;
    onClose?: () => void;
}

export function ColumnPicker({ columns, onColumnsChange, onReset, onClose }: ColumnPickerProps) {
    const toggleVisibility = (id: string) => {
        onColumnsChange(
            columns.map(col => col.id === id ? { ...col, visible: !col.visible } : col)
        );
    };

    const handleReorder = (newOrder: string[]) => {
        const reordered = newOrder.map(id => columns.find(c => c.id === id)!);
        onColumnsChange(reordered);
    };

    return (
        <div className="flex flex-col gap-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5 shadow-2xl w-80 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                    <Eye size={16} className="text-blue-500" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Customize Columns</span>
                </div>
                {onClose && (
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-[var(--text-muted)]">
                        <X size={16} />
                    </Button>
                )}
            </div>

            {/* Column List */}
            <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                <Reorder.Group axis="y" values={columns.map(c => c.id)} onReorder={handleReorder} className="space-y-1">
                    {columns.map((col) => (
                        <Reorder.Item
                            key={col.id}
                            value={col.id}
                            className={`flex items-center gap-3 p-2 rounded-lg cursor-grab active:cursor-grabbing group transition-colors ${col.visible ? 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]' : 'opacity-50 grayscale hover:opacity-80'
                                }`}
                        >
                            <GripVertical size={14} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />

                            <div className="flex items-center gap-3 flex-1">
                                <Checkbox
                                    checked={col.visible}
                                    onCheckedChange={() => toggleVisibility(col.id)}
                                    className="border-[var(--border-default)] data-[state=checked]:bg-blue-600"
                                />
                                <span className={`text-xs ${col.visible ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                                    {col.label}
                                </span>
                            </div>

                            {col.visible ? (
                                <Eye size={14} className="text-blue-500 opacity-0 group-hover:opacity-100" />
                            ) : (
                                <EyeOff size={14} className="text-[var(--text-muted)]" />
                            )}
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReset}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5"
                >
                    <RefreshCw size={12} />
                    Reset Default
                </Button>
                <Button
                    size="sm"
                    onClick={onClose}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8"
                >
                    Done
                </Button>
            </div>
        </div>
    );
}
