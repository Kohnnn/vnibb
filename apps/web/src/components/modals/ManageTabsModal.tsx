// Manage Tabs Modal - Add, rename, reorder, delete tabs (OpenBB-style)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, GripVertical, Trash2, Plus } from 'lucide-react';
import type { DashboardTab } from '@/types/dashboard';

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
        const newTab: DashboardTab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: 'New Tab',
            order: localTabs.length,
            widgets: [],
        };
        setLocalTabs(prev => [...prev, newTab]);
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

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                onClick={handleCancel}
            />

            {/* Modal */}
            <div className="fixed inset-0 flex items-center justify-center z-[101] p-4">
                <div
                    className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
                        <h2 className="text-lg font-semibold text-white">Manage Tabs</h2>
                        <button
                            onClick={handleCancel}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
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
                                    flex items-center gap-2 p-2 rounded-lg
                                    bg-gray-800/50 border border-gray-700
                                    ${draggedIndex === index ? 'opacity-50' : ''}
                                    ${dragOverIndex === index ? 'ring-2 ring-blue-500' : ''}
                                    transition-all
                                `}
                            >
                                {/* Drag handle */}
                                <button
                                    className="p-1 cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <GripVertical size={18} />
                                </button>

                                {/* Tab name input */}
                                <input
                                    type="text"
                                    value={tab.name}
                                    onChange={(e) => handleNameChange(index, e.target.value)}
                                    className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="Tab name"
                                />

                                {/* Delete button */}
                                <button
                                    onClick={() => handleDelete(index)}
                                    disabled={localTabs.length <= 1}
                                    className={`
                                        p-2 rounded-lg transition-colors
                                        ${localTabs.length <= 1
                                            ? 'text-gray-600 cursor-not-allowed'
                                            : 'text-gray-400 hover:text-red-400 hover:bg-gray-700'
                                        }
                                    `}
                                    title={localTabs.length <= 1 ? 'Cannot delete the only tab' : 'Delete tab'}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}

                        {/* Add tab button */}
                        <button
                            onClick={handleAddTab}
                            className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                        >
                            <Plus size={18} />
                            <span>Add New Tab</span>
                        </button>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
                        <button
                            onClick={handleCancel}
                            className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
