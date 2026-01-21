'use client';

import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';
import { useEffect, useState, useCallback, type ReactNode } from 'react';

interface MaximizedWidgetPortalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}

export function MaximizedWidgetPortal({
    isOpen,
    onClose,
    title,
    children
}: MaximizedWidgetPortalProps) {
    const [mounted, setMounted] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    // Handle mount state for SSR safety
    useEffect(() => {
        setMounted(true);
    }, []);

    // Trigger animation on open
    useEffect(() => {
        if (isOpen) {
            // Small delay to trigger CSS transition
            requestAnimationFrame(() => setIsAnimating(true));
        } else {
            setIsAnimating(false);
        }
    }, [isOpen]);

    // Handle Escape key to close
    useEffect(() => {
        if (!isOpen) return;

        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    // Prevent body scroll when maximized
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    // Handle backdrop click
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    if (!mounted || !isOpen) return null;

    return createPortal(
        <div
            className={`
                fixed inset-0 z-50 flex items-center justify-center p-6
                transition-all duration-200 ease-out
                ${isAnimating ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/0'}
            `}
            onClick={handleBackdropClick}
        >
            <div
                className={`
                    w-full h-full bg-[#0b1021] border border-[#1e2a3b] rounded-lg 
                    shadow-2xl flex flex-col overflow-hidden
                    transition-all duration-200 ease-out
                    ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                `}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2a3b] bg-[#0a0f1d]">
                    <span className="text-sm font-medium text-white">{title}</span>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white"
                        title="Minimize (Esc)"
                    >
                        <Minimize2 size={16} />
                    </button>
                </div>
                {/* Content - flex-1 ensures it fills remaining space */}
                <div className="flex-1 overflow-auto">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
