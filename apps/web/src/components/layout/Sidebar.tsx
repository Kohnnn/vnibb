// Sidebar navigation component - Dashboard-centric organization (OpenBB-style)

'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
    Lock,
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import type { Dashboard, DashboardFolder } from '@/types/dashboard';
import { SettingsModal } from '@/components/settings/SettingsModal';

const COLLAPSED_SIDEBAR_WIDTH = 56;

interface SidebarProps {
    onOpenWidgetLibrary?: () => void;
    onOpenAppsLibrary?: () => void;
    onOpenPromptsLibrary?: () => void;
    onOpenTemplateSelector?: () => void;
    mobileMode?: boolean;
    width?: number;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    onWidthChange?: (width: number) => void;
}

export function Sidebar({
    onOpenWidgetLibrary,
    onOpenAppsLibrary,
    onOpenPromptsLibrary,
    onOpenTemplateSelector,
    mobileMode = false,
    width = 208,
    collapsed = false,
    onCollapsedChange,
    onWidthChange,
}: SidebarProps) {
    const INITIAL_FOLDER_ID = 'folder-initial';
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ id: string; type: 'dashboard' | 'folder'; x: number; y: number } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
    const createMenuRef = useRef<HTMLDivElement | null>(null);
    const contextMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (mobileMode) {
            onCollapsedChange?.(false);
        }
    }, [mobileMode, onCollapsedChange]);

    const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (mobileMode || collapsed || !onWidthChange) return;

        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = startWidth + (moveEvent.clientX - startX);
            onWidthChange(nextWidth);
        };

        const handleMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        if (!showCreateMenu && !showMoveSubmenu) {
            return;
        }

        const handleOutsideClick = (event: MouseEvent) => {
            const targetNode = event.target as Node;

            if (showCreateMenu && createMenuRef.current && !createMenuRef.current.contains(targetNode)) {
                setShowCreateMenu(false);
            }

            if (
                showMoveSubmenu &&
                contextMenuRef.current &&
                !contextMenuRef.current.contains(targetNode)
            ) {
                setShowMoveSubmenu(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [showCreateMenu, showMoveSubmenu]);


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
    const initialFolders = sortedFolders.filter(
        (folder) => folder.id === INITIAL_FOLDER_ID || folder.name.trim().toLowerCase() === 'initial'
    );
    const customFolders = sortedFolders.filter(
        (folder) => folder.id !== INITIAL_FOLDER_ID && folder.name.trim().toLowerCase() !== 'initial'
    );

    const nextDashboardName = () => {
        const existing = new Set(
            state.dashboards.map((dashboard) => dashboard.name.trim().toLowerCase())
        );
        let nextNumber = 1;
        while (existing.has(`dashboard ${nextNumber}`)) {
            nextNumber += 1;
        }
        return `Dashboard ${nextNumber}`;
    };

    const withUniqueDashboardName = (rawName: string, currentDashboardId?: string) => {
        const baseName = rawName.trim() || nextDashboardName();
        const normalize = (value: string) => value.trim().toLowerCase();
        const existing = new Set(
            state.dashboards
                .filter((dashboard) => dashboard.id !== currentDashboardId)
                .map((dashboard) => normalize(dashboard.name))
        );

        if (!existing.has(normalize(baseName))) {
            return baseName;
        }

        let suffix = 2;
        let candidate = `${baseName} (${suffix})`;
        while (existing.has(normalize(candidate))) {
            suffix += 1;
            candidate = `${baseName} (${suffix})`;
        }

        return candidate;
    };

    const nextFolderName = () => {
        const existing = new Set(
            state.folders.map((folder) => folder.name.trim().toLowerCase())
        );
        let nextNumber = 1;
        while (existing.has(`folder ${nextNumber}`)) {
            nextNumber += 1;
        }
        return `Folder ${nextNumber}`;
    };

    const withUniqueFolderName = (rawName: string, currentFolderId?: string) => {
        const baseName = rawName.trim() || nextFolderName();
        const normalize = (value: string) => value.trim().toLowerCase();
        const existing = new Set(
            state.folders
                .filter((folder) => folder.id !== currentFolderId)
                .map((folder) => normalize(folder.name))
        );

        if (!existing.has(normalize(baseName))) {
            return baseName;
        }

        let suffix = 2;
        let candidate = `${baseName} (${suffix})`;
        while (existing.has(normalize(candidate))) {
            suffix += 1;
            candidate = `${baseName} (${suffix})`;
        }

        return candidate;
    };

    const adminInitialLayoutModeEnabled = state.dashboards.some(
        (dashboard) => dashboard.folderId === INITIAL_FOLDER_ID && dashboard.adminUnlocked === true,
    );

    const isDashboardEditable = (dashboard: Dashboard | undefined) => {
        return dashboard?.adminUnlocked === true || (dashboard?.isEditable ?? true) !== false;
    };

    const isDashboardDeletable = (dashboard: Dashboard | undefined) => {
        return dashboard?.adminUnlocked === true || (dashboard?.isDeletable ?? true) !== false;
    };

    const isSystemFolder = (folder: DashboardFolder | undefined) => {
        return folder?.id === INITIAL_FOLDER_ID;
    };

    const handleCreateDashboard = (folderId?: string) => {
        if (folderId === INITIAL_FOLDER_ID && !adminInitialLayoutModeEnabled) {
            return;
        }
        const dashboard = createDashboard({
            name: withUniqueDashboardName(nextDashboardName()),
            folderId,
        });
        setActiveDashboard(dashboard.id);
        setEditingId(dashboard.id);
        setEditingName(dashboard.name);
        setShowCreateMenu(false);
    };

    const handleCreateFolder = () => {
        const folder = createFolder(withUniqueFolderName(nextFolderName()));
        setEditingId(folder.id);
        setEditingName(folder.name);
        setShowCreateMenu(false);
    };

    const handleContextMenu = (e: React.MouseEvent, id: string, type: 'dashboard' | 'folder') => {
        e.preventDefault();
        setShowCreateMenu(false);
        setShowMoveSubmenu(false);
        setContextMenu({ id, type, x: e.clientX, y: e.clientY });
    };

    const handleRename = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'dashboard') {
            const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
            if (dashboard && isDashboardEditable(dashboard)) {
                setEditingId(dashboard.id);
                setEditingName(dashboard.name);
            }
        } else {
            const folder = state.folders.find(f => f.id === contextMenu.id);
            if (folder && !isSystemFolder(folder)) {
                setEditingId(folder.id);
                setEditingName(folder.name);
            }
        }
        setContextMenu(null);
        setShowMoveSubmenu(false);
    };

    const handleDelete = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'dashboard') {
            const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
            if (!isDashboardDeletable(dashboard)) {
                setContextMenu(null);
                setShowMoveSubmenu(false);
                return;
            }
            deleteDashboard(contextMenu.id);
        } else {
            const folder = state.folders.find(f => f.id === contextMenu.id);
            if (isSystemFolder(folder)) {
                setContextMenu(null);
                setShowMoveSubmenu(false);
                return;
            }
            deleteFolder(contextMenu.id);
        }
        setContextMenu(null);
        setShowMoveSubmenu(false);
    };

    const handleDuplicate = () => {
        if (!contextMenu || contextMenu.type !== 'dashboard') return;
        const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
        if (dashboard && isDashboardEditable(dashboard)) {
            createDashboard({
                name: withUniqueDashboardName(`${dashboard.name} (Copy)`),
                folderId: dashboard.folderId,
            });
        }
        setContextMenu(null);
        setShowMoveSubmenu(false);
    };

    const submitRename = () => {
        if (!editingId) {
            setEditingId(null);
            return;
        }

        const trimmedName = editingName.trim();

        const dashboard = state.dashboards.find(d => d.id === editingId);
        if (dashboard) {
            updateDashboard(editingId, {
                name: withUniqueDashboardName(trimmedName || nextDashboardName(), editingId),
            });
        } else {
            const folder = state.folders.find(f => f.id === editingId);
            if (folder) {
                updateFolder(editingId, {
                    name: withUniqueFolderName(trimmedName, editingId),
                });
            }
        }
        setEditingId(null);
    };

    const handleMoveToFolder = (targetFolderId: string | undefined) => {
        if (!contextMenu || contextMenu.type !== 'dashboard') return;
        if (targetFolderId === INITIAL_FOLDER_ID && !adminInitialLayoutModeEnabled) {
            setContextMenu(null);
            setShowMoveSubmenu(false);
            return;
        }
        const dashboard = state.dashboards.find(d => d.id === contextMenu.id);
        if (!isDashboardEditable(dashboard)) {
            setContextMenu(null);
            setShowMoveSubmenu(false);
            return;
        }
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
        if (folderId === INITIAL_FOLDER_ID) {
            handleDragEnd();
            return;
        }
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
        const isEditableDashboard = isDashboardEditable(dashboard);
        const isDeletableDashboard = isDashboardDeletable(dashboard);

        return (
            <div
                key={dashboard.id}
                draggable={!isEditing && isEditableDashboard}
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
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/60'
                    }
                    ${isDragging ? 'opacity-50' : ''}
                    ${isDragOver ? 'border-t border-blue-500' : ''}
                `}
                style={{ paddingLeft: `${6 + indent * 12}px` }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!isEditing) setActiveDashboard(dashboard.id);
                    }
                }}
                onClick={() => !isEditing && setActiveDashboard(dashboard.id)}
                onDoubleClick={() => {
                    if (!isEditableDashboard) return;
                    setEditingId(dashboard.id);
                    setEditingName(dashboard.name);
                }}
                onContextMenu={(e) => {
                    if (!isEditableDashboard && !isDeletableDashboard) return;
                    handleContextMenu(e, dashboard.id, 'dashboard');
                }}
            >
                <FileText size={14} className="shrink-0" />
                {isEditing ? (
                    <input
                        type="text"
                        value={editingName}
                        aria-label="Dashboard name"
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={submitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-primary)] text-sm focus:outline-none focus:border-blue-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <>
                        <span className="flex-1 truncate">{dashboard.name}</span>
                        {(isEditableDashboard || isDeletableDashboard) && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--bg-tertiary)] rounded transition-opacity"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleContextMenu(e, dashboard.id, 'dashboard');
                                }}
                            >
                                <MoreVertical size={14} />
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    };

    const renderFolderItem = (folder: DashboardFolder) => {
        const isEditing = editingId === folder.id;
        const folderDashboards = (dashboardsByFolder.get(folder.id) || []).sort((a, b) => a.order - b.order);
        const isDragOver = dragOverFolderId === folder.id;
        const lockedFolder = isSystemFolder(folder);

        return (
            <div key={folder.id}>
                <div
                        className={`
                        group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer 
                        text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/60 transition-colors text-xs
                        ${isDragOver ? 'bg-[var(--bg-tertiary)] ring-1 ring-blue-500' : ''}
                    `}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (!isEditing) toggleFolder(folder.id);
                        }
                    }}
                    onClick={() => !isEditing && toggleFolder(folder.id)}
                    onContextMenu={(e) => {
                        if (lockedFolder) return;
                        handleContextMenu(e, folder.id, 'folder');
                    }}
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
                            aria-label="Folder name"
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={submitRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-primary)] text-sm focus:outline-none focus:border-blue-500"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <>
                            <span className="flex-1 truncate">{folder.name}</span>
                            {lockedFolder && (
                                <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                                    <Lock size={9} className="mr-1" />
                                    System
                                </span>
                            )}
                            <span className="text-[10px] text-[var(--text-muted)]">{folderDashboards.length}</span>
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

    const contextDashboard =
        contextMenu?.type === 'dashboard'
            ? state.dashboards.find((dashboard) => dashboard.id === contextMenu.id)
            : undefined;
    const contextFolder =
        contextMenu?.type === 'folder'
            ? state.folders.find((folder) => folder.id === contextMenu.id)
            : undefined;
    const contextDashboardEditable = isDashboardEditable(contextDashboard);
    const contextDashboardDeletable = isDashboardDeletable(contextDashboard);
    const contextFolderEditable = !isSystemFolder(contextFolder);

    return (
        <>
            <aside
                data-mobile-sidebar={mobileMode ? 'true' : 'false'}
                className={`
                    relative bg-[var(--bg-secondary)] border-r border-[var(--border-color)]
                    flex flex-col
                    ${mobileMode
                        ? 'relative h-full w-full'
                        : 'hidden lg:flex h-screen shrink-0'
                    }
                `}
                style={mobileMode ? undefined : { width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width }}
            >

                {/* Logo */}
                <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border-color)] shrink-0">
                    {!collapsed && (
                        <Link href="/" className="flex items-center gap-2">
                            <span
                                className="text-lg font-bold bg-clip-text text-transparent"
                                style={{ backgroundImage: 'var(--sidebar-brand-gradient)' }}
                            >
                                VNIBB
                            </span>
                        </Link>
                    )}
                    {!mobileMode && (
                        <button
                            onClick={() => onCollapsedChange?.(!collapsed)}
                            className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        >
                            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    )}
                </div>

                {/* Dashboards Section */}
                <div className="flex-1 overflow-y-auto px-2 py-1">
                    {!collapsed && (
                        <>
                            <div className="space-y-0.5" data-tour="sidebar-workspaces">
                                <div className="mb-3 border-b border-[var(--border-color)] pb-2">
                                    <div className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                        Customize
                                    </div>
                                    <button
                                        onClick={onOpenTemplateSelector}
                                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/60 hover:text-[var(--text-primary)]"
                                    >
                                        <AppWindow size={14} />
                                        <span>Templates</span>
                                    </button>
                                    <button
                                        onClick={onOpenWidgetLibrary}
                                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/60 hover:text-[var(--text-primary)]"
                                    >
                                        <Grid3X3 size={14} />
                                        <span>Widgets</span>
                                    </button>
                                    <button
                                        onClick={onOpenPromptsLibrary}
                                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/60 hover:text-[var(--text-primary)]"
                                    >
                                        <MessageSquareText size={14} />
                                        <span>Prompts</span>
                                    </button>
                                </div>

                                <div className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                    Initial Workspaces
                                </div>
                                {initialFolders.map(renderFolderItem)}

                                <div className="mt-3 flex items-center justify-between px-1.5 py-0.5">
                                    <h3 className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                                        Custom Workspaces
                                    </h3>
                                    <div ref={createMenuRef} className="relative">
                                        <button
                                            onClick={() => setShowCreateMenu(!showCreateMenu)}
                                            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                        >
                                            <Plus size={14} />
                                        </button>
                                        {showCreateMenu && (
                                            <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl">
                                                <button
                                                    onClick={() => handleCreateDashboard()}
                                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                                                >
                                                    <LayoutDashboard size={14} />
                                                    <span>Create Dashboard</span>
                                                </button>
                                                <button
                                                    onClick={handleCreateFolder}
                                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                                                >
                                                    <Folder size={14} />
                                                    <span>New Folder</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {customFolders.map(renderFolderItem)}
                                {rootDashboards.map(d => renderDashboardItem(d))}
                            </div>
                        </>
                    )}

                    {collapsed && (
                        <div className="space-y-1">
                            <button
                                onClick={() => onCollapsedChange?.(false)}
                                className="w-full flex justify-center p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/80 transition-colors"
                                title="Dashboards"
                            >
                                <Layers size={18} />
                            </button>
                        </div>
                    )}
                </div>

                {!mobileMode && !collapsed && onWidthChange ? (
                    <div
                        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/30"
                        onMouseDown={handleResizeStart}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize workspace sidebar"
                    />
                ) : null}

                {/* Footer with Settings and Version */}
                <div className="px-2 py-1 border-t border-[var(--border-color)] shrink-0">
                    <button
                        onClick={() => setSettingsOpen(true)}
                        className={`
                            flex items-center gap-2 px-2 py-1 rounded w-full
                            text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/60
                            transition-colors text-xs
                        `}
                    >
                        <Settings size={14} className="shrink-0" />
                        {!collapsed && (
                            <div className="flex items-center justify-between flex-1">
                                <span>Settings</span>
                            </div>
                        )}
                    </button>
                    {!collapsed && (
                        <div className="px-2 py-1 text-[10px] text-[var(--text-muted)]">
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
                        role="button"
                        tabIndex={0}
                        aria-label="Close context menu"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setContextMenu(null);
                                setShowMoveSubmenu(false);
                            }
                        }}
                        onClick={() => {
                            setContextMenu(null);
                            setShowMoveSubmenu(false);
                        }}
                    />
                    <div
                        ref={contextMenuRef}
                        className="fixed z-[70] min-w-[140px] rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] py-0.5 shadow-xl"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <button
                            onClick={handleRename}
                            disabled={contextMenu.type === 'dashboard' ? !contextDashboardEditable : !contextFolderEditable}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Edit2 size={12} />
                            <span>Rename</span>
                        </button>
                        {contextMenu.type === 'dashboard' && (
                            <>
                                <button
                                    onClick={handleDuplicate}
                                    disabled={!contextDashboardEditable}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
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
                                    disabled={!contextDashboardEditable}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
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
                                        disabled={!contextDashboardEditable}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <FolderInput size={12} />
                                        <span>Move to Folder</span>
                                        <ChevronRight size={12} className="ml-auto" />
                                    </button>
                                    {showMoveSubmenu && (
                                        <div className="absolute left-full top-0 z-[80] ml-1 w-40 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] py-0.5 shadow-xl">
                                            <button
                                                onClick={() => handleMoveToFolder(undefined)}
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                                            >
                                                <FolderX size={12} />
                                                <span>No Folder (Root)</span>
                                            </button>
                                            {state.folders.filter(folder => folder.id !== INITIAL_FOLDER_ID).map(folder => (
                                                <button
                                                    key={folder.id}
                                                    onClick={() => handleMoveToFolder(folder.id)}
                                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
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
                        <div className="my-0.5 border-t border-[var(--border-color)]" />
                        <button
                            onClick={handleDelete}
                            disabled={contextMenu.type === 'dashboard' ? !contextDashboardDeletable : !contextFolderEditable}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-red-500 hover:bg-[var(--bg-tertiary)] hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Trash2 size={12} />
                            <span>Delete</span>
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
