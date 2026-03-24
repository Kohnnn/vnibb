// Refined Popover components for VNIBB Design System
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const PopoverContext = createContext<{
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    rootRef: React.RefObject<HTMLDivElement | null>;
} | null>(null);

export const Popover = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    return (
        <PopoverContext.Provider value={{ isOpen, setIsOpen, rootRef }}>
            <div ref={rootRef} className="relative inline-block">
                {children}
            </div>
        </PopoverContext.Provider>
    );
};

export const PopoverTrigger = ({ children, asChild }: any) => {
    const context = useContext(PopoverContext);
    if (!context) return null;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        context.setIsOpen(!context.isOpen);
    };

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<any>, {
            onClick: handleClick
        });
    }

    return <button onClick={handleClick}>{children}</button>;
};

export const PopoverContent = ({ children, className = '', align = 'center' }: any) => {
    const context = useContext(PopoverContext);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                context?.setIsOpen(false);
            }
        };

        const handleClickOutside = (event: MouseEvent) => {
            if (context?.rootRef.current && !context.rootRef.current.contains(event.target as Node)) {
                context?.setIsOpen(false);
            }
        };

        if (context?.isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [context]);

    if (!context?.isOpen) return null;

    const alignClasses = {
        left: 'left-0',
        center: 'left-1/2 -translate-x-1/2',
        right: 'right-0',
    };

    return (
        <div
            ref={ref}
            className={cn(
                'absolute z-[100] mt-2 min-w-[8rem] rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 text-[var(--text-primary)] shadow-xl ring-1 ring-[rgba(0,0,0,0.15)] animate-in fade-in zoom-in-95 duration-200',
                alignClasses[align as keyof typeof alignClasses],
                className
            )}
        >
            {children}
        </div>
    );
};
