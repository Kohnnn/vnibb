'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
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

    return (
        <>
            {/* Mobile Menu Button - Only visible on mobile */}
            <button
                onClick={() => setIsOpen(true)}
                className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                aria-label="Open menu"
            >
                <Menu size={24} />
            </button>

            {/* Mobile Drawer Overlay */}
            {isOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
                    role="button"
                    tabIndex={0}
                    aria-label="Close menu"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsOpen(false);
                        }
                    }}
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Mobile Drawer */}
            <div
                className={`
                    lg:hidden fixed top-0 left-0 h-full w-72 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] z-50
                    transform transition-transform duration-300 ease-in-out
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                {/* Close Button */}
                <button
                    onClick={() => setIsOpen(false)}
                    className="absolute top-4 right-4 p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>

                {/* Sidebar Content */}
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
    );
}
