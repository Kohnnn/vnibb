import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, Check } from 'lucide-react';

const DropdownMenuContext = createContext<{
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
} | null>(null);

export const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <DropdownMenuContext.Provider value={{ isOpen, setIsOpen }}>
            <div className="relative inline-block text-left">
                {children}
            </div>
        </DropdownMenuContext.Provider>
    );
};

export const DropdownMenuTrigger = ({ children, asChild }: any) => {
    const context = useContext(DropdownMenuContext);
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

export const DropdownMenuContent = ({ children, className = '', align = 'center' }: any) => {
    const context = useContext(DropdownMenuContext);
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
        start: 'left-0',
        center: 'left-1/2 -translate-x-1/2',
        end: 'right-0',
    };

    return (
        <div
            ref={ref}
            className={cn(
                "absolute z-50 mt-2 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95",
                alignClasses[align as keyof typeof alignClasses] || alignClasses.center,
                className
            )}
        >
            {children}
        </div>
    );
};

export const DropdownMenuItem = ({ children, onClick, className }: any) => {
    const context = useContext(DropdownMenuContext);
    return (
        <div
            className={cn(
                "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className
            )}
            onClick={(e) => {
                e.stopPropagation();
                onClick?.(e);
                context?.setIsOpen(false);
            }}
        >
            {children}
        </div>
    );
};

export const DropdownMenuCheckboxItem = ({ children, checked, onCheckedChange, className }: any) => {
    // Prevent closing on checkbox toggle usually, but here straightforward
    return (
        <div
            className={cn(
                "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                className
            )}
            onClick={(e) => {
                e.stopPropagation();
                onCheckedChange?.(!checked);
            }}
        >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {checked && <Check className="h-4 w-4" />}
            </span>
            {children}
        </div>
    );
};

export const DropdownMenuLabel = ({ children, className }: any) => (
    <div className={cn("px-2 py-1.5 text-sm font-semibold", className)}>
        {children}
    </div>
);

export const DropdownMenuSeparator = ({ className }: any) => (
    <div className={cn("-mx-1 my-1 h-px bg-muted", className)} />
);

export const DropdownMenuSub = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div 
            className="relative"
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            {React.Children.map(children, child => {
                if (React.isValidElement(child)) {
                    return React.cloneElement(child as React.ReactElement<any>, { isOpen, setIsOpen });
                }
                return child;
            })}
        </div>
    );
};

export const DropdownMenuSubTrigger = ({ children, className, isOpen }: any) => (
    <div className={cn(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        isOpen && "bg-accent text-accent-foreground",
        className
    )}>
        {children}
        <ChevronRight className="ml-auto h-4 w-4" />
    </div>
);

export const DropdownMenuSubContent = ({ children, className, isOpen }: any) => {
    if (!isOpen) return null;
    return (
        <div className={cn(
            "absolute left-full top-0 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95 ml-1",
            className
        )}>
            {children}
        </div>
    );
};

