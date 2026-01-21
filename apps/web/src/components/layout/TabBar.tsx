// Tab Navigation Bar - Enhanced with inline rename, drag-drop reorder, keyboard shortcuts

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings2, Plus, X, GripVertical } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { ManageTabsModal } from '@/components/modals/ManageTabsModal';
import { useTouchGestures } from '@/hooks/useTouchGestures';
import type { DashboardTab } from '@/types/dashboard';

interface TabBarProps {
    symbol?: string;
}

export function TabBar({ symbol }: TabBarProps) {
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [deleteConfirmTabId, setDeleteConfirmTabId] = useState<string | null>(null);
    const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
    const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

    const editInputRef = useRef<HTMLInputElement>(null);
    const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const {
        activeDashboard,
        activeTab,
        setActiveTab,
        createTab,
        updateTab,
        deleteTab,
        reorderTabs,
    } = useDashboard();

    // Focus input when editing starts
    useEffect(() => {
        if (editingTabId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingTabId]);

    // Clear delete confirmation after timeout
    useEffect(() => {
        if (deleteConfirmTabId) {
            deleteTimeoutRef.current = setTimeout(() => {
                setDeleteConfirmTabId(null);
            }, 3000);
        }
        return () => {
            if (deleteTimeoutRef.current) {
                clearTimeout(deleteTimeoutRef.current);
            }
        };
    }, [deleteConfirmTabId]);

    // Keyboard shortcuts: Ctrl+T (new tab), Ctrl+W (close tab)
    useEffect(() => {
        if (!activeDashboard) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger if user is typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            // Ctrl+T: New tab
            if (e.ctrlKey && e.key === 't') {
                e.preventDefault();
                handleAddTab();
            }

            // Ctrl+W: Close current tab (if more than 1 tab)
            if (e.ctrlKey && e.key === 'w') {
                if (activeDashboard.tabs.length > 1 && activeTab) {
                    e.preventDefault();
                    handleDeleteTab(activeTab.id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeDashboard, activeTab]);

    if (!activeDashboard) {
        return (
            <div className="border-b border-[#1e2a3b] bg-[#0b1021]/80 backdrop-blur-sm h-9 flex items-center px-4">
                <span className="text-gray-500 text-xs">No dashboard selected</span>
            </div>
        );
    }

    const sortedTabs = [...activeDashboard.tabs].sort((a, b) => a.order - b.order);

    // Swipe gesture handlers for mobile tab navigation
    const handleSwipeLeft = useCallback(() => {
        if (!activeTab) return;
        const currentIndex = sortedTabs.findIndex(t => t.id === activeTab.id);
        if (currentIndex < sortedTabs.length - 1) {
            setActiveTab(sortedTabs[currentIndex + 1].id);
        }
    }, [activeTab, sortedTabs, setActiveTab]);

    const handleSwipeRight = useCallback(() => {
        if (!activeTab) return;
        const currentIndex = sortedTabs.findIndex(t => t.id === activeTab.id);
        if (currentIndex > 0) {
            setActiveTab(sortedTabs[currentIndex - 1].id);
        }
    }, [activeTab, sortedTabs, setActiveTab]);

    const swipeHandlers = useTouchGestures({
        onSwipeLeft: handleSwipeLeft,
        onSwipeRight: handleSwipeRight,
    });

    const handleTabClick = (tabId: string) => {
        if (editingTabId !== tabId) {
            setActiveTab(tabId);
        }
    };

    const handleAddTab = () => {
        const tab = createTab(activeDashboard.id, 'New Tab');
        setActiveTab(tab.id);
        // Auto-start editing the new tab name
        setEditingTabId(tab.id);
        setEditingName('New Tab');
    };

    // Double-click to start inline rename
    const handleDoubleClick = (tab: DashboardTab) => {
        setEditingTabId(tab.id);
        setEditingName(tab.name);
    };

    // Confirm rename
    const handleRenameConfirm = () => {
        if (editingTabId && editingName.trim()) {
            updateTab(activeDashboard.id, editingTabId, { name: editingName.trim() });
        }
        setEditingTabId(null);
        setEditingName('');
    };

    // Cancel rename
    const handleRenameCancel = () => {
        setEditingTabId(null);
        setEditingName('');
    };

    // Handle rename input keydown
    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleRenameConfirm();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleRenameCancel();
        }
    };

    // Delete tab with confirmation
    const handleDeleteTab = (tabId: string) => {
        if (activeDashboard.tabs.length <= 1) return;

        if (deleteConfirmTabId === tabId) {
            // Second click - actually delete
            deleteTab(activeDashboard.id, tabId);
            setDeleteConfirmTabId(null);

            // Switch to first available tab if we deleted the active one
            if (activeTab?.id === tabId) {
                const remainingTabs = sortedTabs.filter(t => t.id !== tabId);
                if (remainingTabs.length > 0) {
                    setActiveTab(remainingTabs[0].id);
                }
            }
        } else {
            // First click - show confirmation
            setDeleteConfirmTabId(tabId);
        }
    };

    // Drag and drop handlers
    const handleDragStart = (e: React.DragEvent, tabId: string) => {
        setDraggedTabId(tabId);
        e.dataTransfer.effectAllowed = 'move';
        // Add a slight delay to show drag effect
        setTimeout(() => {
            const element = e.target as HTMLElement;
            element.style.opacity = '0.5';
        }, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        const element = e.target as HTMLElement;
        element.style.opacity = '1';

        if (draggedTabId && dragOverTabId && draggedTabId !== dragOverTabId) {
            // Reorder tabs
            const draggedIndex = sortedTabs.findIndex(t => t.id === draggedTabId);
            const dropIndex = sortedTabs.findIndex(t => t.id === dragOverTabId);

            if (draggedIndex !== -1 && dropIndex !== -1) {
                const newTabs = [...sortedTabs];
                const [dragged] = newTabs.splice(draggedIndex, 1);
                newTabs.splice(dropIndex, 0, dragged);

                // Update order values
                const reorderedTabs = newTabs.map((tab, i) => ({ ...tab, order: i }));
                reorderTabs(activeDashboard.id, reorderedTabs);
            }
        }

        setDraggedTabId(null);
        setDragOverTabId(null);
    };

    const handleDragOver = (e: React.DragEvent, tabId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedTabId && draggedTabId !== tabId) {
            setDragOverTabId(tabId);
        }
    };

    const handleDragLeave = () => {
        setDragOverTabId(null);
    };

    const handleSaveTabs = (tabs: DashboardTab[]) => {
        reorderTabs(activeDashboard.id, tabs);
        // If active tab was deleted, switch to first tab
        const tabIds = tabs.map(t => t.id);
        if (activeTab && !tabIds.includes(activeTab.id)) {
            setActiveTab(tabs[0]?.id || '');
        }
    };

    return (
        <>
            <div className="border-b border-[#1e2a3b] bg-[#0b1021]/80 backdrop-blur-sm" {...swipeHandlers}>
                <div className="flex items-center gap-0.5 px-3">
                    {/* Tabs */}
                    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
                        {sortedTabs.map((tab) => {
                            const isActive = activeTab?.id === tab.id;
                            const isEditing = editingTabId === tab.id;
                            const isDragging = draggedTabId === tab.id;
                            const isDragOver = dragOverTabId === tab.id;
                            const isDeleteConfirm = deleteConfirmTabId === tab.id;

                            return (
                                <div
                                    key={tab.id}
                                    draggable={!isEditing}
                                    onDragStart={(e) => handleDragStart(e, tab.id)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={(e) => handleDragOver(e, tab.id)}
                                    onDragLeave={handleDragLeave}
                                    className={`
                                        group relative flex items-center gap-1 px-1 py-1 text-xs font-medium 
                                        transition-all whitespace-nowrap rounded-t cursor-pointer
                                        ${isActive
                                            ? 'text-white bg-[#1e2a3b] border-t border-l border-r border-[#2e3a4b]'
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-[#1e2a3b]/30'
                                        }
                                        ${isDragging ? 'opacity-50' : ''}
                                        ${isDragOver ? 'ring-2 ring-blue-500 ring-inset' : ''}
                                    `}
                                    onClick={() => handleTabClick(tab.id)}
                                    onDoubleClick={() => handleDoubleClick(tab)}
                                >
                                    {/* Drag handle (visible on hover) */}
                                    <span className="opacity-0 group-hover:opacity-50 cursor-grab active:cursor-grabbing">
                                        <GripVertical size={12} />
                                    </span>

                                    {/* Tab name or edit input */}
                                    {isEditing ? (
                                        <input
                                            ref={editInputRef}
                                            type="text"
                                            value={editingName}
                                            onChange={(e) => setEditingName(e.target.value)}
                                            onBlur={handleRenameConfirm}
                                            onKeyDown={handleRenameKeyDown}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-20 bg-[#0b1021] border border-blue-500 rounded px-1 py-0.5 text-xs text-white focus:outline-none"
                                        />
                                    ) : (
                                        <span className="px-1">{tab.name}</span>
                                    )}

                                    {/* Close button (visible on hover for active tab or when confirming delete) */}
                                    {sortedTabs.length > 1 && (isActive || isDeleteConfirm) && !isEditing && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteTab(tab.id);
                                            }}
                                            className={`
                                                p-0.5 rounded transition-colors
                                                ${isDeleteConfirm
                                                    ? 'text-red-400 bg-red-500/20 hover:bg-red-500/30'
                                                    : 'text-gray-500 hover:text-gray-300 hover:bg-[#2e3a4b]/50 opacity-0 group-hover:opacity-100'
                                                }
                                            `}
                                            title={isDeleteConfirm ? 'Click again to confirm delete' : 'Close tab'}
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Add tab button */}
                    <button
                        onClick={handleAddTab}
                        className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#1e2a3b]/50 rounded transition-colors ml-1"
                        title="Add new tab (Ctrl+T)"
                    >
                        <Plus size={14} />
                    </button>

                    {/* Edit tabs button */}
                    <button
                        onClick={() => setIsManageModalOpen(true)}
                        className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#1e2a3b]/50 rounded transition-colors"
                        title="Manage tabs"
                    >
                        <Settings2 size={14} />
                    </button>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Keyboard shortcuts hint */}
                    <div className="hidden md:flex items-center gap-2 text-[10px] text-gray-600 mr-2">
                        <span className="px-1 py-0.5 bg-gray-800/50 rounded">Ctrl+T</span>
                        <span>new</span>
                        <span className="px-1 py-0.5 bg-gray-800/50 rounded">Ctrl+W</span>
                        <span>close</span>
                    </div>

                    {/* Ticker badge */}
                    {symbol && (
                        <div className="flex items-center gap-1.5 pr-1.5">
                            <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400 rounded border border-blue-500/20">
                                {symbol}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Manage Tabs Modal */}
            <ManageTabsModal
                isOpen={isManageModalOpen}
                onClose={() => setIsManageModalOpen(false)}
                tabs={activeDashboard.tabs}
                onSave={handleSaveTabs}
            />
        </>
    );
}

// Re-export the DashboardTab type for backwards compatibility
export type { DashboardTab };
