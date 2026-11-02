// Manage Tabs Modal - Add, rename, reorder, delete tabs (OpenBB-style)

'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { X, GripVertical, Trash2, Plus } from 'lucide-react';
import type { DashboardTab } from '@/types/dashboard';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { MAX_TABS } from '@/contexts/DashboardContext/constants';

interface ManageTabsModalProps {
    isOpen: boolean;
    onClose: () => void;
    tabs: DashboardTab[];
    onSave: (tabs: DashboardTab[]) => void;
}

export function ManageTabsModal({ isOpen, onClose, tabs, onSave }: ManageTabsModalProps) {
    const [localTabs, setLocalTabs] = useState<DashboardTab[]>([]);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const movedHandleRef = useRef<HTMLButtonElement | null>(null);

    useLayoutEffect(() => {
        movedHandleRef.current?.focus();
        movedHandleRef.current = null;
    }, [localTabs]);

    // Reset local state when modal opens
    useEffect(() => {
        if (isOpen) {
            setLocalTabs([...tabs].sort((a, b) => a.order - b.order));
        }
    }, [isOpen, tabs]);

    const handleNameChange = (index: number, name: string) => {
        setLocalTabs(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], name };
            return updated;
        });
    };

    const handleDelete = (index: number) => {
        if (localTabs.length <= 1) return; // Keep at least one tab
        setLocalTabs(prev => prev.filter((_, i) => i !== index));
    };

    const handleAddTab = () => {
        setLocalTabs(prev => {
            if (prev.length >= MAX_TABS) return prev;
            return [...prev, {
                id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                name: 'New Tab',
                order: prev.length,
                widgets: [],
            }];
        });
    };

    const handleDragStart = (index: number) => {
        setDraggedIndex(index);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handleDragEnd = () => {
        if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
            setLocalTabs(prev => {
                const updated = [...prev];
                const [dragged] = updated.splice(draggedIndex, 1);
                updated.splice(dragOverIndex, 0, dragged);
                // Update order values
                return updated.map((tab, i) => ({ ...tab, order: i }));
            });
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleReorderKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        event.stopPropagation();
        const targetIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (targetIndex < 0 || targetIndex >= localTabs.length) return;
        movedHandleRef.current = event.currentTarget;
        setLocalTabs(prev => {
            const updated = [...prev];
            [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
            return updated.map((tab, order) => ({ ...tab, order }));
        });
    };

    const handleSave = () => {
        // Update order values and save
        const orderedTabs = localTabs.map((tab, i) => ({ ...tab, order: i }));
        onSave(orderedTabs);
        onClose();
    };

    const handleCancel = () => {
        setLocalTabs([...tabs].sort((a, b) => a.order - b.order));
        onClose();
    };
    const dialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: isOpen, onClose: handleCancel });
    const reachedTabLimit = localTabs.length >= MAX_TABS;

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[100] bg-[rgb(2_6_23_/_0.72)]"
                aria-hidden="true"
                onClick={handleCancel}
            />

            {/* Modal */}
            <div className="fixed inset-0 flex items-center justify-center z-[101] p-4">
                <div
                    ref={dialogRef}
                    className="w-full max-w-md rounded-md border border-[var(--border-strong)] bg-[var(--bg-modal)] shadow-lg"
                    onClick={e => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="manage-tabs-title"
                    tabIndex={-1}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
                        <h2 id="manage-tabs-title" className="text-lg font-semibold text-[var(--text-primary)]">Manage Tabs</h2>
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                            aria-label="Close manage tabs"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
                        {localTabs.map((tab, index) => (
                            <div
                                key={tab.id}
                                draggable
                                onDragStart={() => handleDragStart(index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDragEnd={handleDragEnd}
                                className={`
                                    flex items-center gap-2 p-2 rounded-md
                                    bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]
                                    ${draggedIndex === index ? 'opacity-50' : ''}
                                    ${dragOverIndex === index ? 'ring-2 ring-[var(--focus-ring-color)]' : ''}
                                    transition-colors
                                `}
                            >
                                {/* Drag handle */}
                                <button
                                    type="button"
                                    className="p-1 cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onKeyDown={(event) => handleReorderKeyDown(event, index)}
                                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                                    title="Move tab with Alt+ArrowUp or Alt+ArrowDown"
                                    aria-label="Reorder tab"
                                >
                                    <GripVertical size={18} />
                                </button>

                                {/* Tab name input */}
                                <input
                                    type="text"
                                    value={tab.name}
                                    aria-label="Tab name"
                                    onChange={(e) => handleNameChange(index, e.target.value)}
                                    className="flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
                                    placeholder="Tab name"
                                />

                                {/* Delete button */}
                                <button
                                    type="button"
                                    onClick={() => handleDelete(index)}
                                    disabled={localTabs.length <= 1}
                                    className={`
                                        rounded p-2 transition-colors
                                        ${localTabs.length <= 1
                                            ? 'cursor-not-allowed text-[var(--text-muted)] opacity-40'
                                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                                        }
                                    `}
                                    title={localTabs.length <= 1 ? 'Cannot delete the only tab' : 'Delete tab'}
                                    aria-label={`Delete ${tab.name}`}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}

                        {/* Add tab button */}
                        <button
                            type="button"
                            onClick={handleAddTab}
                            disabled={reachedTabLimit}
                            title={reachedTabLimit ? `Maximum ${MAX_TABS} tabs` : undefined}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] p-3 text-[var(--text-muted)] transition-colors hover:border-[var(--color-accent-primary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Plus size={18} />
                            <span>Add New Tab</span>
                        </button>
                        {reachedTabLimit && (
                            <p className="text-xs text-[var(--text-muted)]">
                                Maximum {MAX_TABS} tabs. Delete a tab to add another.
                            </p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--border-color)]">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="rounded-md px-4 py-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="rounded-md bg-[var(--color-accent-primary)] px-4 py-2 font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
