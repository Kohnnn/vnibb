'use client';

import React, { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ChevronRight, Check } from 'lucide-react';

type FocusDirection = 'first' | 'last';

const DropdownMenuContext = createContext<{
    isOpen: boolean;
    menuId: string;
    triggerRef: React.RefObject<HTMLElement | null>;
    contentRef: React.RefObject<HTMLDivElement | null>;
    focusDirection: React.RefObject<FocusDirection>;
    openMenu: (direction?: FocusDirection) => void;
    closeMenu: (restoreFocus?: boolean) => void;
} | null>(null);

const SubmenuContext = createContext<{
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    triggerRef: React.RefObject<HTMLDivElement | null>;
    contentId: string;
} | null>(null);

function menuItems(menu: HTMLElement) {
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'))
        .filter(item => item.closest('[role="menu"]') === menu && item.getAttribute('aria-disabled') !== 'true');
}

function navigateMenu(event: React.KeyboardEvent, menu: HTMLElement) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = menuItems(menu);
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length
        : (index <= 0 ? items.length : index) - 1;
    items[next].focus();
}

export const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const focusDirection = useRef<FocusDirection>('first');
    const menuId = useId();

    const context = useMemo(() => ({
        isOpen, menuId, triggerRef, contentRef, focusDirection,
        openMenu: (direction: FocusDirection = 'first') => {
            focusDirection.current = direction;
            setIsOpen(true);
        },
        closeMenu: (restoreFocus = false) => {
            setIsOpen(false);
            if (restoreFocus) triggerRef.current?.focus();
        },
    }), [isOpen, menuId]);

    return (
        <DropdownMenuContext.Provider value={context}>
            <div className="relative inline-block text-left">{children}</div>
        </DropdownMenuContext.Provider>
    );
};

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children: React.ReactNode };

export const DropdownMenuTrigger = ({ children, asChild, onClick, onKeyDown, ...props }: TriggerProps) => {
    const context = useContext(DropdownMenuContext);
    if (!context) return null;

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        if (context.isOpen) context.closeMenu(true);
        else context.openMenu();
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        context.openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    };
    const aria = { 'aria-haspopup': 'menu' as const, 'aria-expanded': context.isOpen, 'aria-controls': context.menuId };

    if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<React.HTMLAttributes<HTMLElement> & { disabled?: boolean; ref?: React.Ref<HTMLElement> }>;
        const childRef = child.props.ref;
        return React.cloneElement(child, {
            ...props,
            ...aria,
            ref: (node: HTMLElement | null) => {
                context.triggerRef.current = node;
                if (typeof childRef === 'function') childRef(node);
                else if (childRef) (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
            },
            onClick: event => {
                child.props.onClick?.(event);
                onClick?.(event as React.MouseEvent<HTMLButtonElement>);
                if (!event.defaultPrevented && !child.props.disabled && !props.disabled) handleClick(event);
            },
            onKeyDown: event => {
                child.props.onKeyDown?.(event);
                onKeyDown?.(event as React.KeyboardEvent<HTMLButtonElement>);
                if (!event.defaultPrevented && !child.props.disabled && !props.disabled) handleKeyDown(event);
            },
        });
    }

    return <button type="button" {...props} {...aria} ref={context.triggerRef as React.Ref<HTMLButtonElement>}
        onClick={event => { onClick?.(event); if (!event.defaultPrevented) handleClick(event); }}
        onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented) handleKeyDown(event); }}>
        {children}
    </button>;
};

type ContentProps = React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end' };

export const DropdownMenuContent = ({ children, className = '', align = 'center', style, onKeyDown, ...props }: ContentProps) => {
    const { isOpen, menuId, contentRef, triggerRef, focusDirection: focusDirectionRef, closeMenu } = useContext(DropdownMenuContext) ?? {};
    const [position, setPosition] = useState<React.CSSProperties>({ position: 'fixed' });

    useLayoutEffect(() => {
        if (!isOpen) return;
        const menu = contentRef?.current;
        const trigger = triggerRef?.current;
        if (!menu || !trigger) return;

        const positionMenu = () => {
            const anchor = trigger.getBoundingClientRect();
            const width = menu.offsetWidth;
            const height = menu.scrollHeight;
            const margin = 8;
            const availableBelow = window.innerHeight - anchor.bottom - margin * 2;
            const above = availableBelow < height && anchor.top - margin * 2 > availableBelow;
            const availableHeight = Math.max(0, above ? anchor.top - margin * 2 : availableBelow);
            const desiredLeft = align === 'start' ? anchor.left : align === 'end' ? anchor.right - width : anchor.left + (anchor.width - width) / 2;
            setPosition({
                position: 'fixed',
                top: above ? Math.max(margin, anchor.top - Math.min(height, availableHeight) - margin) : anchor.bottom + margin,
                left: Math.max(margin, Math.min(desiredLeft, window.innerWidth - width - margin)),
                maxWidth: `calc(100vw - ${margin * 2}px)`,
                maxHeight: availableHeight,
                overflowY: 'auto',
            });
        };

        positionMenu();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
        observer?.observe(menu);
        window.addEventListener('resize', positionMenu);
        window.addEventListener('scroll', positionMenu, true);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', positionMenu);
            window.removeEventListener('scroll', positionMenu, true);
        };
    }, [isOpen, contentRef, triggerRef, align]);

    useLayoutEffect(() => {
        if (!isOpen) return;
        const menu = contentRef?.current;
        const items = menu && menuItems(menu);
        const first = focusDirectionRef?.current === 'last' ? items?.at(-1) : items?.[0];
        (first || menu)?.focus();
    }, [isOpen, contentRef, focusDirectionRef]);

    useLayoutEffect(() => {
        if (!isOpen || !closeMenu) return;
        const handleOutside = (event: Event) => {
            const target = event.target as Node;
            if (!contentRef?.current?.contains(target) && !triggerRef?.current?.contains(target)) closeMenu();
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMenu(true);
            }
        };
        const handlePopState = () => closeMenu();
        document.addEventListener('pointerdown', handleOutside, true);
        document.addEventListener('click', handleOutside, true);
        document.addEventListener('focusin', handleOutside);
        document.addEventListener('keydown', handleEscape, true);
        window.addEventListener('popstate', handlePopState);
        return () => {
            document.removeEventListener('pointerdown', handleOutside, true);
            document.removeEventListener('click', handleOutside, true);
            document.removeEventListener('focusin', handleOutside);
            document.removeEventListener('keydown', handleEscape, true);
            window.removeEventListener('popstate', handlePopState);
        };
    }, [isOpen, contentRef, triggerRef, closeMenu]);

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div {...props} id={menuId} ref={contentRef} role="menu" tabIndex={-1} data-dropdown-menu-content=""
            style={{ ...style, ...position }}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (event.key === 'Tab') closeMenu?.(true);
                else if ((event.target as HTMLElement).closest('[role="menu"]') === event.currentTarget) navigateMenu(event, event.currentTarget);
            }}
            className={cn(
                'z-[140] min-w-[8rem] overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 text-[var(--text-primary)] shadow-xl ring-1 ring-[rgba(0,0,0,0.15)] animate-in fade-in-80 zoom-in-95',
                className
            )}>
            {children}
        </div>,
        document.body
    );
};

type ItemProps = React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean };

export const DropdownMenuItem = ({ children, onClick, onKeyDown, className, disabled, ...props }: ItemProps) => {
    const context = useContext(DropdownMenuContext);
    const activate = (event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.stopPropagation();
        context?.closeMenu(true);
        onClick?.(event as React.MouseEvent<HTMLDivElement>);
    };
    return (
        <div {...props} role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined}
            data-disabled={disabled ? '' : undefined}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className
            )}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    activate(event);
                }
            }}
            onClick={activate}>
            {children}
        </div>
    );
};

type CheckboxProps = Omit<ItemProps, 'onClick'> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void };

export const DropdownMenuCheckboxItem = ({ children, checked, onCheckedChange, className, disabled, onKeyDown, ...props }: CheckboxProps) => {
    const activate = (event: React.MouseEvent | React.KeyboardEvent) => {
        if (disabled) return;
        event.stopPropagation();
        onCheckedChange?.(!checked);
    };
    return (
        <div {...props} role="menuitemcheckbox" tabIndex={-1} aria-checked={!!checked} aria-disabled={disabled || undefined}
            data-disabled={disabled ? '' : undefined}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className
            )}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    activate(event);
                }
            }}
            onClick={activate}>
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {checked && <Check className="h-4 w-4" />}
            </span>
            {children}
        </div>
    );
};

export const DropdownMenuLabel = ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('px-2 py-1.5 text-sm font-semibold text-[var(--text-primary)]', className)}>{children}</div>
);

export const DropdownMenuSeparator = ({ className }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role="separator" className={cn('-mx-1 my-1 h-px bg-[var(--border-color)]', className)} />
);

export const DropdownMenuSub = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const contentId = useId();
    const context = useMemo(() => ({ isOpen, setIsOpen, triggerRef, contentId }), [isOpen, contentId]);
    return (
        <SubmenuContext.Provider value={context}>
            <div className="relative">
                {children}
            </div>
        </SubmenuContext.Provider>
    );
};

export const DropdownMenuSubTrigger = ({ children, className, onClick, onKeyDown, disabled, ...props }: ItemProps) => {
    const sub = useContext(SubmenuContext);
    return (
        <div {...props} ref={sub?.triggerRef} role="menuitem" tabIndex={-1} aria-haspopup="menu"
            aria-expanded={!!sub?.isOpen} aria-controls={sub?.contentId} aria-disabled={disabled || undefined}
            data-disabled={disabled ? '' : undefined}
            className={cn(
                'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                sub?.isOpen && 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]', className
            )}
            onClick={event => {
                event.stopPropagation();
                if (disabled) return;
                onClick?.(event);
                if (!event.defaultPrevented) {
                    event.currentTarget.focus();
                    sub?.setIsOpen(!sub.isOpen);
                }
            }}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (event.defaultPrevented || !sub || disabled) return;
                if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    sub.setIsOpen(true);
                    const menu = document.getElementById(sub.contentId);
                    if (menu) menuItems(menu)[0]?.focus();
                } else if (event.key === 'ArrowLeft' && sub.isOpen) {
                    event.preventDefault();
                    sub.setIsOpen(false);
                }
            }}>
            {children}<ChevronRight className="ml-auto h-4 w-4" />
        </div>
    );
};

export const DropdownMenuSubContent = ({ children, className, onKeyDown, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
    const sub = useContext(SubmenuContext);
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (sub?.isOpen && ref.current && document.activeElement === sub.triggerRef.current) menuItems(ref.current)[0]?.focus();
    }, [sub]);

    if (!sub?.isOpen) return null;
    return (
        <div {...props} id={sub.contentId} ref={ref} role="menu"
            className={cn('min-w-[8rem] rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 pl-3 text-[var(--text-primary)] shadow-inner', className)}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    event.stopPropagation();
                    sub.setIsOpen(false);
                    sub.triggerRef.current?.focus();
                } else navigateMenu(event, event.currentTarget);
            }}>
            {children}
        </div>
    );
};
