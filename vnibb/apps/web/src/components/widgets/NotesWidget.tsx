// Notes Widget - Personal notes for stocks

'use client';

import { useState, useEffect } from 'react';
import { StickyNote, Save, Trash2 } from 'lucide-react';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';

interface NotesWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
}

function parseNotesBySymbol(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
}

export function NotesWidget({ id, symbol, config, isEditing, onRemove }: NotesWidgetProps) {
    const { updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);
    const persistedNotes = parseNotesBySymbol(config?.notesBySymbol);
    const [notes, setNotes] = useState('');
    const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
    const [isSaved, setIsSaved] = useState(true);

    useEffect(() => {
        setSavedNotes(persistedNotes);
        setNotes(persistedNotes[symbol] || '');
        setIsSaved(true);
    }, [persistedNotes, symbol]);

    const saveNote = () => {
        const updated = { ...savedNotes, [symbol]: notes };
        setSavedNotes(updated);
        if (widgetLocation) {
            updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
                config: {
                    ...widgetLocation.widget.config,
                    notesBySymbol: updated,
                },
            });
        }
        setIsSaved(true);
    };

    const clearNote = () => {
        setNotes('');
        const updated = { ...savedNotes };
        delete updated[symbol];
        setSavedNotes(updated);
        if (widgetLocation) {
            updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
                config: {
                    ...widgetLocation.widget.config,
                    notesBySymbol: updated,
                },
            });
        }
        setIsSaved(true);
    };

    const handleChange = (value: string) => {
        setNotes(value);
        setIsSaved(false);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <StickyNote size={12} className="text-yellow-400" />
                    <span>Notes - {symbol}</span>
                    {!isSaved && <span className="text-orange-400">•</span>}
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta note="Saved in dashboard" align="right" />
                    <button
                        onClick={saveNote}
                        className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-green-400"
                        title="Save"
                    >
                        <Save size={12} />
                    </button>
                    <button
                        onClick={clearNote}
                        className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-red-400"
                        title="Clear"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {/* Notes Textarea */}
            <div className="flex-1 px-1">
                <textarea
                    value={notes}
                    onChange={(e) => handleChange(e.target.value)}
                    placeholder={`Write your notes about ${symbol}...`}
                    className="h-full w-full resize-none rounded bg-[var(--bg-tertiary)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
            </div>

            {/* Footer */}
            <div className="px-1 py-1 text-right text-[10px] text-[var(--text-muted)]">
                {notes.length} characters
            </div>
        </div>
    );
}
