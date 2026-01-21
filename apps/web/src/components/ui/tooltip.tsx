import React, { useState } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export const Tooltip = ({ children }: { children: React.ReactNode }) => {
    const [isVisible, setIsVisible] = useState(false);

    // Clone children to inject props if needed, but simple Context or random ID is better.
    // For simplicity without context bloat:
    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {React.Children.map(children, child => {
                if (React.isValidElement(child)) {
                    // @ts-ignore
                    return React.cloneElement(child, { isVisible });
                }
                return child;
            })}
        </div>
    );
};

export const TooltipTrigger = ({ children, asChild }: any) => {
    return <>{children}</>;
};

export const TooltipContent = ({ children, isVisible, className }: any) => {
    if (!isVisible) return null;
    return (
        <div className={cn(
            "absolute z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "bottom-full mb-2 left-1/2 -translate-x-1/2", // Default to top
            className
        )}>
            {children}
        </div>
    );
};
