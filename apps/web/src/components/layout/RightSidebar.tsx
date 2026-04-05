// Right Sidebar for VniAgent and workspace context
'use client';

import { MessageSquare, ChevronRight } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

interface RightSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    width?: number;
    overlay?: boolean;
    onWidthChange?: (width: number) => void;
    children: React.ReactNode;
}

export function RightSidebar({
    isOpen,
    onToggle,
    width = 320,
    overlay = false,
    onWidthChange,
    children
}: RightSidebarProps) {
    const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (overlay || !isOpen || !onWidthChange) return;

        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = startWidth - (moveEvent.clientX - startX);
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

    const asideClassName = overlay
        ? `fixed top-12 bottom-0 right-0 z-40 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] transition-transform duration-300 ease-in-out flex flex-col shadow-[0_12px_32px_rgba(2,6,23,0.22)]`
        : `relative h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col shadow-[0_12px_32px_rgba(2,6,23,0.22)]`;

    const asideStyle: CSSProperties = overlay
        ? {
            width: isOpen ? width : 0,
            transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
            visibility: isOpen ? 'visible' : 'hidden',
            maxWidth: 'calc(100vw - 1rem)',
        }
        : {
            width,
        };

    return (
        <aside
            className={asideClassName}
            style={asideStyle}
        >
            {!overlay && isOpen && onWidthChange ? (
                <div
                    className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/30"
                    onMouseDown={handleResizeStart}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize VniAgent sidebar"
                />
            ) : null}

            {/* Header */}
            <div className="h-10 flex items-center justify-between px-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/70">
                <div className="flex items-center gap-2 text-blue-400">
                    <MessageSquare size={16} />
                    <span className="font-semibold text-sm">VniAgent</span>
                </div>
                <button
                    onClick={onToggle}
                    className="p-1 hover:bg-[var(--bg-elevated)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    aria-label="Close VniAgent"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {children}
            </div>
        </aside>
    );
}

// Trigger button to be placed in the header or floating
export function SidebarTrigger({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) {
    if (isOpen) return null; // Hide trigger when open usually, or keep it.
    // OpenBB keeps a small sidebar of icons on the right, or a toggle in the header.
    // Requirement: "Move the 'AI Copilot' triggers to this sidebar". 
    // If sidebar is closed, how do we open it? 
    // We'll assume the main Header or a thin strip on the right will have the toggle.
    // For now, let's export a simple toggle button.

    return (
        <button
            onClick={onClick}
            className="p-2 text-[var(--text-secondary)] transition-colors hover:text-blue-400"
            title="Open VniAgent"
            aria-label="Open VniAgent"
        >
            <MessageSquare size={20} />
        </button>
    );
}
