// Right Sidebar for AI Copilot and Context
'use client';

import { useState, useEffect } from 'react';
import { X, MessageSquare, ChevronRight, ChevronLeft } from 'lucide-react';

interface RightSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    width?: number;
    children: React.ReactNode;
}

export function RightSidebar({
    isOpen,
    onToggle,
    width = 320,
    children
}: RightSidebarProps) {
    // We render the sidebar fixed to the right, but also return space-occupying div if we want flow
    // Or we handle flow in the parent. 
    // OpenBB style: The grid resizes. So this component should probably just be the sidebar UI, 
    // and the parent `DashboardPage` handles the resizing logic.

    return (
        <aside
            className={`
                fixed top-12 bottom-0 right-0 z-40
                bg-[#0b1221] border-l border-[#1e293b]
                transition-all duration-300 ease-in-out
                flex flex-col
            `}
            style={{
                width: isOpen ? width : 0,
                transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
                // Make completely invisible when closed to prevent interaction
                visibility: isOpen ? 'visible' : 'hidden'
            }}
        >
            {/* Header */}
            <div className="h-10 flex items-center justify-between px-4 border-b border-[#1e293b] bg-[#0f172a]">
                <div className="flex items-center gap-2 text-blue-400">
                    <MessageSquare size={16} />
                    <span className="font-semibold text-sm">Copilot</span>
                </div>
                <button
                    onClick={onToggle}
                    className="p-1 hover:bg-[#1e293b] rounded text-gray-400 hover:text-white transition-colors"
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
            className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
            title="Open Copilot"
        >
            <MessageSquare size={20} />
        </button>
    );
}
