// Refined Popover components for VniBB Design System
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const PopoverContext = createContext<{
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    rootRef: React.RefObject<HTMLDivElement | null>;
} | null>(null);

export const Popover = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Consume Escape before a wrapping dialog's document listener.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!isOpen || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
    };

    return (
        <PopoverContext.Provider value={{ isOpen, setIsOpen, rootRef }}>
            <div ref={rootRef} onKeyDown={handleKeyDown} data-popover-open={isOpen || undefined} className={cn('relative inline-block', className)}>
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
            onClick: handleClick,
            'aria-expanded': context.isOpen,
        });
    }

    return <button type="button" onClick={handleClick} aria-expanded={context.isOpen}>{children}</button>;
};

export const PopoverContent = ({ children, className = '', align = 'center' }: any) => {
    const context = useContext(PopoverContext);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (context?.rootRef.current && !context.rootRef.current.contains(event.target as Node)) {
                context?.setIsOpen(false);
            }
        };

        if (context?.isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
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
                'absolute z-[100] mt-2 min-w-[8rem] rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 text-[var(--text-primary)] shadow-lg animate-in fade-in zoom-in-95 duration-200',
                alignClasses[align as keyof typeof alignClasses],
                className
            )}
        >
            {children}
        </div>
    );
};
