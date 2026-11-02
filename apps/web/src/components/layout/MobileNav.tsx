'use client';

import { useCallback, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { Sidebar } from './Sidebar';

interface MobileNavProps {
    onOpenWidgetLibrary: () => void;
    onOpenAppsLibrary: () => void;
    onOpenPromptsLibrary: () => void;
    onOpenTemplateSelector?: () => void;
}

export function MobileNav({
    onOpenWidgetLibrary,
    onOpenAppsLibrary,
    onOpenPromptsLibrary,
    onOpenTemplateSelector,
}: MobileNavProps) {
    const [isOpen, setIsOpen] = useState(false);
    const closeMenu = useCallback((source: string) => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.mobileMenuClosed, { source });
        setIsOpen(false);
    }, []);
    const handleEscape = useCallback(() => closeMenu('escape'), [closeMenu]);
    const panelRef = useDialogFocusTrap<HTMLDivElement>({ enabled: isOpen, onClose: handleEscape });

    return (
        <>
            <button
                onClick={() => {
                    captureAnalyticsEvent(ANALYTICS_EVENTS.mobileMenuOpened, {
                        source: 'mobile_nav_button',
                    });
                    setIsOpen(true);
                }}
                className="fixed left-2 top-2 z-40 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] lg:hidden"
                aria-label="Open menu"
            >
                <Menu size={24} />
            </button>

            {isOpen && (
                <>
                    <button
                        type="button"
                        className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.6)] transition-opacity lg:hidden"
                        aria-label="Close navigation overlay"
                        onClick={() => closeMenu('overlay_click')}
                    />
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Navigation menu"
                        tabIndex={-1}
                        className="fixed left-0 top-0 z-50 h-full w-[min(18rem,85vw)] overflow-y-auto border-r border-[var(--border-color)] bg-[var(--bg-secondary)] transition-transform duration-300 ease-in-out lg:hidden"
                    >
                        <button
                            type="button"
                            onClick={() => closeMenu('close_button')}
                            className="absolute top-4 right-4 p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            aria-label="Close menu"
                        >
                            <X size={20} />
                        </button>
                        <Sidebar
                            mobileMode
                            onOpenWidgetLibrary={() => {
                                onOpenWidgetLibrary();
                                setIsOpen(false);
                            }}
                            onOpenAppsLibrary={() => {
                                onOpenAppsLibrary();
                                setIsOpen(false);
                            }}
                            onOpenPromptsLibrary={() => {
                                onOpenPromptsLibrary();
                                setIsOpen(false);
                            }}
                            onOpenTemplateSelector={() => {
                                onOpenTemplateSelector?.();
                                setIsOpen(false);
                            }}
                        />
                    </div>
                </>
            )}
        </>
    );
}
