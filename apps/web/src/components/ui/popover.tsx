// Refined Popover components for VNIBB Design System
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';

const PopoverContext = createContext<{
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
} | null>(null);

export const Popover = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <PopoverContext.Provider value={{ isOpen, setIsOpen }}>
            <div className="relative inline-block">
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
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
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
            className={`absolute z-[100] mt-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${alignClasses[align as keyof typeof alignClasses]} ${className}`}
        >
            {children}
        </div>
    );
};
