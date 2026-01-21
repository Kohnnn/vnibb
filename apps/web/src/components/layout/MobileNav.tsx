'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';

interface MobileNavProps {
    onOpenWidgetLibrary: () => void;
    onOpenAppsLibrary: () => void;
    onOpenPromptsLibrary: () => void;
}

export function MobileNav({
    onOpenWidgetLibrary,
    onOpenAppsLibrary,
    onOpenPromptsLibrary,
}: MobileNavProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            {/* Mobile Menu Button - Only visible on mobile */}
            <button
                onClick={() => setIsOpen(true)}
                className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-[#0b1021] border border-[#1e2a3b] rounded-lg text-gray-400 hover:text-white hover:bg-[#1e2a3b] transition-colors"
                aria-label="Open menu"
            >
                <Menu size={24} />
            </button>

            {/* Mobile Drawer Overlay */}
            {isOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Mobile Drawer */}
            <div
                className={`
                    lg:hidden fixed top-0 left-0 h-full w-64 bg-[#0a1628] border-r border-gray-800 z-50
                    transform transition-transform duration-300 ease-in-out
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                {/* Close Button */}
                <button
                    onClick={() => setIsOpen(false)}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>

                {/* Sidebar Content */}
                <Sidebar
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
                />
            </div>
        </>
    );
}
