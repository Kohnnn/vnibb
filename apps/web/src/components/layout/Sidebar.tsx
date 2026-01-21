// Sidebar navigation component - Dashboard-centric organization (OpenBB-style)

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    LayoutDashboard,
    Settings,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Plus,
    Folder,
    FolderOpen,
    MoreVertical,
    FileText,
    Trash2,
    Edit2,
    Copy,
    Layers,
    Grid3X3,
    Eye,
    EyeOff,
    FolderInput,
    FolderX,
    AppWindow,
    MessageSquareText,
    Search,
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import type { Dashboard, DashboardFolder } from '@/types/dashboard';
import { SettingsModal } from '@/components/settings/SettingsModal';

interface SidebarProps {
    onOpenWidgetLibrary?: () => void;
    onOpenAppsLibrary?: () => void;
    onOpenPromptsLibrary?: () => void;
    onOpenTemplateSelector?: () => void;
}

export function Sidebar({ onOpenWidgetLibrary, onOpenAppsLibrary, onOpenPromptsLibrary, onOpenTemplateSelector }: SidebarProps) {

    const [collapsed, setCollapsed] = useState(false);
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ id: string; type: 'dashboard' | 'folder'; x: number; y: number } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);


    const {
        state,
        activeDashboard,
        setActiveDashboard,
        createDashboard,
        updateDashboard,
        deleteDashboard,
        createFolder,
        updateFolder,
        deleteFolder,
        toggleFolder,
        moveDashboard,
        reorderDashboards,
    } = useDashboard();

    // Drag-and-drop state
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);

    // Group dashboards by folder
    const foldersById = new Map(state.folders.map(f => [f.id, f]));
    const dashboardsByFolder = new Map<string | undefined, Dashboard[]>();

    state.dashboards.forEach(d => {
        const key = d.folderId;
        if (!dashboardsByFolder.has(key)) {
            dashboardsByFolder.set(key, []);
        }
        dashboardsByFolder.get(key)!.push(d);
    });

    // Sort dashboards and folders by order
    const sortedFolders = [...state.folders].sort((a, b) => a.order - b.order);
    const rootDashboards = (dashboardsByFolder.get(undefined) || []).sort((a, b) => a.order - b.order);

    const handleCreateDashboard = (folderId?: string) => {
        const dashboard = createDashboard({
            name: 'New Dashboard',
            folderId,
        });
        setActiveDashboard(dashboard.id);
        setEditingId(dashboard.id);
        setEditingName(dashboard.name);
        setShowCreateMenu(false);
    };

    const handleCreateFolder = () => {
        const folder = createFolder('New Folder');
        setEditingId(folder.id);
        setEditingName(folder.name);
        setShowCreateMenu(false);
    };

    const handleContextMenu = (e: React.MouseEvent, id: string, type: 'dashboard' | 'folder') => {
        e.preventDefault();
        setContextMenu({ id, type, x: e.clientX, y: e.clientY });
    };

    const handleRename = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'dashboard') {
            const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
            if (dashboard) {
                setEditingId(dashboard.id);
                setEditingName(dashboard.name);
            }
        } else {
            const folder = state.folders.find(f => f.id === contextMenu.id);
            if (folder) {
                setEditingId(folder.id);
                setEditingName(folder.name);
            }
        }
        setContextMenu(null);
    };

    const handleDelete = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'dashboard') {
            deleteDashboard(contextMenu.id);
        } else {
            deleteFolder(contextMenu.id);
        }
        setContextMenu(null);
    };

    const handleDuplicate = () => {
        if (!contextMenu || contextMenu.type !== 'dashboard') return;
        const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
        if (dashboard) {
            createDashboard({
                name: `${dashboard.name} (Copy)`,
                folderId: dashboard.folderId,
            });
        }
        setContextMenu(null);
    };

    const submitRename = () => {
        if (!editingId || !editingName.trim()) {
            setEditingId(null);
            return;
        }

        const dashboard = state.dashboards.find(d => d.id === editingId);
        if (dashboard) {
            updateDashboard(editingId, { name: editingName.trim() });
        } else {
            const folder = state.folders.find(f => f.id === editingId);
            if (folder) {
                updateFolder(editingId, { name: editingName.trim() });
            }
        }
        setEditingId(null);
    };

    const handleMoveToFolder = (targetFolderId: string | undefined) => {
        if (!contextMenu || contextMenu.type !== 'dashboard') return;
        moveDashboard(contextMenu.id, targetFolderId);
        setContextMenu(null);
        setShowMoveSubmenu(false);
    };

    // Drag and drop handlers
    const handleDragStart = (e: React.DragEvent, dashboardId: string) => {
        setDraggedId(dashboardId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dashboardId);
    };

    const handleDragEnd = () => {
        setDraggedId(null);
        setDragOverId(null);
        setDragOverFolderId(null);
    };

    const handleDragOver = (e: React.DragEvent, targetId: string, isFolder: boolean) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (isFolder) {
            setDragOverFolderId(targetId);
            setDragOverId(null);
        } else {
            setDragOverId(targetId);
            setDragOverFolderId(null);
        }
    };

    const handleDragLeave = () => {
        setDragOverId(null);
        setDragOverFolderId(null);
    };

    const handleDropOnFolder = (e: React.DragEvent, folderId: string | undefined) => {
        e.preventDefault();
        if (!draggedId) return;
        moveDashboard(draggedId, folderId);
        handleDragEnd();
    };

    const handleDropOnDashboard = (e: React.DragEvent, targetDashboard: Dashboard) => {
        e.preventDefault();
        if (!draggedId || draggedId === targetDashboard.id) return;

        const targetFolderId = targetDashboard.folderId;
        const dashboardsInFolder = state.dashboards
            .filter(d => d.folderId === targetFolderId)
            .sort((a, b) => a.order - b.order);

        // Build new order
        const draggedDashboard = state.dashboards.find(d => d.id === draggedId);
        if (!draggedDashboard) return;

        const filteredDashboards = dashboardsInFolder.filter(d => d.id !== draggedId);
        const targetIndex = filteredDashboards.findIndex(d => d.id === targetDashboard.id);

        const newOrder = [
            ...filteredDashboards.slice(0, targetIndex + 1),
            draggedDashboard,
            ...filteredDashboards.slice(targetIndex + 1),
        ].map(d => d.id);

        reorderDashboards(newOrder, targetFolderId);
        handleDragEnd();
    };

    const renderDashboardItem = (dashboard: Dashboard, indent = 0) => {
        const isActive = activeDashboard?.id === dashboard.id;
        const isEditing = editingId === dashboard.id;
        const isDragging = draggedId === dashboard.id;
        const isDragOver = dragOverId === dashboard.id;

        return (
            <div
                key={dashboard.id}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, dashboard.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, dashboard.id, false)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnDashboard(e, dashboard)}
                className={`
                    group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer
                    transition-colors text-xs
                    ${isActive
                        ? 'bg-blue-500/15 text-blue-400 border-l-2 border-blue-500'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50'
                    }
                    ${isDragging ? 'opacity-50' : ''}
                    ${isDragOver ? 'border-t border-blue-500' : ''}
                `}
                style={{ paddingLeft: `${6 + indent * 12}px` }}
                onClick={() => !isEditing && setActiveDashboard(dashboard.id)}
                onContextMenu={(e) => handleContextMenu(e, dashboard.id, 'dashboard')}
            >
                <FileText size={14} className="shrink-0" />
                {isEditing ? (
                    <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={submitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-white text-sm focus:outline-none focus:border-blue-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <>
                        <span className="flex-1 truncate">{dashboard.name}</span>
                        <button
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-700 rounded transition-opacity"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleContextMenu(e, dashboard.id, 'dashboard');
                            }}
                        >
                            <MoreVertical size={14} />
                        </button>
                    </>
                )}
            </div>
        );
    };

    const renderFolderItem = (folder: DashboardFolder) => {
        const isEditing = editingId === folder.id;
        const folderDashboards = (dashboardsByFolder.get(folder.id) || []).sort((a, b) => a.order - b.order);
        const isDragOver = dragOverFolderId === folder.id;

        return (
            <div key={folder.id}>
                <div
                    className={`
                        group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer 
                        text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50 transition-colors text-xs
                        ${isDragOver ? 'bg-[#1e2a3b] ring-1 ring-blue-500' : ''}
                    `}
                    onClick={() => !isEditing && toggleFolder(folder.id)}
                    onContextMenu={(e) => handleContextMenu(e, folder.id, 'folder')}
                    onDragOver={(e) => handleDragOver(e, folder.id, true)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDropOnFolder(e, folder.id)}
                >
                    {folder.isExpanded ? (
                        <FolderOpen size={14} className="shrink-0 text-yellow-500/80" />
                    ) : (
                        <Folder size={14} className="shrink-0 text-yellow-500/80" />
                    )}
                    {isEditing ? (
                        <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={submitRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-white text-sm focus:outline-none focus:border-blue-500"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <>
                            <span className="flex-1 truncate">{folder.name}</span>
                            <span className="text-[10px] text-gray-600">{folderDashboards.length}</span>
                            {folder.isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </>
                    )}
                </div>
                {folder.isExpanded && (
                    <div className="ml-2">
                        {folderDashboards.map(d => renderDashboardItem(d, 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <aside
                className={`
                    fixed left-0 top-0 h-screen bg-[#0b1021] border-r border-[#1e2a3b]
                    transition-[width] duration-300 z-50 flex flex-col
                    ${collapsed ? 'w-14' : 'w-52'}
                `}
            >

                {/* Logo */}
                <div className="h-10 flex items-center justify-between px-3 border-b border-[#1e2a3b] shrink-0">
                    {!collapsed && (
                        <Link href="/" className="flex items-center gap-2">
                            <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                                VNIBB
                            </span>
                        </Link>
                    )}
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                {/* Global Search */}
                {!collapsed && (
                    <div className="px-2 py-1.5 border-b border-[#1e2a3b]">
                        <button
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded bg-[#0f1629] border border-[#1e2a3b] text-gray-500 hover:text-gray-300 hover:border-[#2e3a4b] transition-colors text-xs"
                            onClick={() => {
                                // Trigger command palette with Ctrl+K
                                const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
                                document.dispatchEvent(event);
                            }}
                        >
                            <Search size={12} />
                            <span className="flex-1 text-left">Search</span>
                            <span className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">⌘K</span>
                        </button>
                    </div>
                )}

                {/* Library Section */}
                {!collapsed && (
                    <div className="px-2 py-1 border-b border-[#1e2a3b]">
                        <h3 className="px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                            Library
                        </h3>
                        <button
                            onClick={onOpenTemplateSelector}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50 transition-colors text-xs"
                        >
                            <AppWindow size={14} />
                            <span>Templates</span>
                        </button>

                        <button
                            onClick={onOpenWidgetLibrary}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50 transition-colors text-xs"
                        >
                            <Grid3X3 size={14} />
                            <span>Widgets</span>
                        </button>
                        <button
                            onClick={onOpenPromptsLibrary}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50 transition-colors text-xs"
                        >
                            <MessageSquareText size={14} />
                            <span>Prompts</span>
                        </button>
                    </div>
                )}

                {/* Dashboards Section */}
                <div className="flex-1 overflow-y-auto px-2 py-1">
                    {!collapsed && (
                        <>
                            <div className="flex items-center justify-between px-1.5 py-0.5 mb-0.5">
                                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    My Dashboards
                                </h3>
                                <div className="relative">
                                    <button
                                        onClick={() => setShowCreateMenu(!showCreateMenu)}
                                        className="p-0.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                                    >
                                        <Plus size={14} />
                                    </button>
                                    {showCreateMenu && (
                                        <div className="absolute right-0 top-full mt-1 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 z-50">
                                            <button
                                                onClick={() => handleCreateDashboard()}
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 hover:text-white"
                                            >
                                                <LayoutDashboard size={14} />
                                                <span>New Dashboard</span>
                                            </button>
                                            <button
                                                onClick={handleCreateFolder}
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 hover:text-white"
                                            >
                                                <Folder size={14} />
                                                <span>New Folder</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-0.5">
                                {/* Render folders first */}
                                {sortedFolders.map(renderFolderItem)}
                                {/* Render root-level dashboards */}
                                {rootDashboards.map(d => renderDashboardItem(d))}
                            </div>
                        </>
                    )}

                    {collapsed && (
                        <div className="space-y-1">
                            <button
                                onClick={() => setCollapsed(false)}
                                className="w-full flex justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/80 transition-colors"
                                title="Dashboards"
                            >
                                <Layers size={18} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer with Settings and Version */}
                <div className="px-2 py-1 border-t border-[#1e2a3b] shrink-0">
                    <button
                        onClick={() => setSettingsOpen(true)}
                        className={`
                            flex items-center gap-2 px-2 py-1 rounded w-full
                            text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3b]/50
                            transition-colors text-xs
                        `}
                    >
                        <Settings size={14} className="shrink-0" />
                        {!collapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span>Settings</span>
                                <div className="flex items-center gap-1 opacity-40">
                                    <kbd className="px-1 text-[8px] bg-gray-800 rounded font-sans">⌘</kbd>
                                    <kbd className="px-1 text-[8px] bg-gray-800 rounded font-sans">K</kbd>
                                </div>
                            </div>
                        )}
                    </button>
                    {!collapsed && (
                        <div className="px-2 py-1 text-[10px] text-gray-600">
                            v1.0.0
                        </div>
                    )}
                </div>
            </aside>

            <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />


            {/* Context Menu */}
            {contextMenu && (
                <>
                    <div
                        className="fixed inset-0 z-[60]"
                        onClick={() => setContextMenu(null)}
                    />
                    <div
                        className="fixed bg-[#0f1629] border border-[#1e2a3b] rounded shadow-xl py-0.5 z-[70] min-w-[140px]"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <button
                            onClick={handleRename}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                        >
                            <Edit2 size={12} />
                            <span>Rename</span>
                        </button>
                        {contextMenu.type === 'dashboard' && (
                            <>
                                <button
                                    onClick={handleDuplicate}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                                >
                                    <Copy size={12} />
                                    <span>Duplicate</span>
                                </button>
                                <button
                                    onClick={() => {
                                        const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
                                        if (dashboard) {
                                            updateDashboard(dashboard.id, { showGroupLabels: !dashboard.showGroupLabels });
                                        }
                                        setContextMenu(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                                >
                                    {state.dashboards.find(d => d.id === contextMenu.id)?.showGroupLabels !== false ? (
                                        <>
                                            <EyeOff size={12} />
                                            <span>Hide grouping</span>
                                        </>
                                    ) : (
                                        <>
                                            <Eye size={12} />
                                            <span>Show grouping</span>
                                        </>
                                    )}
                                </button>
                                <div className="relative">
                                    <button
                                        onClick={() => setShowMoveSubmenu(!showMoveSubmenu)}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                                    >
                                        <FolderInput size={12} />
                                        <span>Move to Folder</span>
                                        <ChevronRight size={12} className="ml-auto" />
                                    </button>
                                    {showMoveSubmenu && (
                                        <div className="absolute left-full top-0 ml-1 w-40 bg-[#0f1629] border border-[#1e2a3b] rounded shadow-xl py-0.5 z-[80]">
                                            <button
                                                onClick={() => handleMoveToFolder(undefined)}
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                                            >
                                                <FolderX size={12} />
                                                <span>No Folder (Root)</span>
                                            </button>
                                            {state.folders.map(folder => (
                                                <button
                                                    key={folder.id}
                                                    onClick={() => handleMoveToFolder(folder.id)}
                                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-[#1e2a3b] hover:text-white"
                                                >
                                                    <Folder size={12} className="text-yellow-500/80" />
                                                    <span className="truncate">{folder.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                        <div className="border-t border-[#1e2a3b] my-0.5" />
                        <button
                            onClick={handleDelete}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-red-400 hover:bg-[#1e2a3b] hover:text-red-300"
                        >
                            <Trash2 size={12} />
                            <span>Delete</span>
                        </button>
                    </div>
                </>
            )}

            {/* Click outside to close create menu and move submenu */}
            {(showCreateMenu || showMoveSubmenu) && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                        setShowCreateMenu(false);
                        setShowMoveSubmenu(false);
                    }}
                />
            )}
        </>
    );
}
