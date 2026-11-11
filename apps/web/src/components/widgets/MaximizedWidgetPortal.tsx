'use client';

import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';
import { useEffect, useState, useCallback, type ReactNode, type RefObject } from 'react';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';

interface MaximizedWidgetPortalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    contentRef?: RefObject<HTMLDivElement | null>;
    children?: ReactNode;
}

export function MaximizedWidgetPortal({
    isOpen,
    onClose,
    title,
    children,
    contentRef,
}: MaximizedWidgetPortalProps) {
    const [mounted, setMounted] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    const dialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: mounted && isOpen, onClose });

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

    useEffect(() => {
        if (!isOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previousOverflow; };
    }, [isOpen]);

    const handleBackdropClick = useCallback((event: React.MouseEvent) => {
        if (event.target === event.currentTarget) onClose();
    }, [onClose]);

    if (!mounted || !isOpen) return null;

    return createPortal(
        <div
            className={`
                fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6
                transition-all duration-200 ease-out
                backdrop-blur-sm
                ${isAnimating ? 'bg-[rgba(2,6,23,0.78)] opacity-100' : 'bg-[rgba(2,6,23,0.78)] opacity-0'}
            `}
            onClick={handleBackdropClick}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className={`
                    w-full h-full bg-[var(--bg-modal)] border border-[var(--border-color)] rounded-lg
                    shadow-[0_24px_80px_rgba(15,23,42,0.45)] flex flex-col overflow-hidden
                    transition-all duration-200 ease-out
                    ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                `}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 sm:px-4 border-b border-[var(--border-color)] bg-[var(--bg-modal)]">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]" title={title}>{title}</span>
                    <button
                        data-maximized-close
                        type="button"
                        onClick={onClose}
                        aria-label="Minimize widget"
                        className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        title="Minimize (Esc)"
                    >
                        <Minimize2 size={16} />
                    </button>
                </div>
                {/* Content - flex-1 ensures it fills remaining space. Padding
                    matches the grid widget content host (WidgetWrapper) so
                    maximized widgets keep a consistent inset now that
                    WidgetContainer no longer self-pads. */}
                <div ref={contentRef} className="min-h-0 flex-1 overflow-auto p-2 sm:p-2.5">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
