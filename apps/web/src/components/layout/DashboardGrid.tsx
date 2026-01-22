'use client';

import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { Responsive } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
// Note: react-resizable styles are bundled with react-grid-layout, no separate import needed


// Define our own layout item type compatible with react-grid-layout
export interface LayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    static?: boolean;
}

// Responsive layouts for different breakpoints
export interface ResponsiveLayouts {
    lg?: LayoutItem[];
    md?: LayoutItem[];
    sm?: LayoutItem[];
    xs?: LayoutItem[];
}

// Default minimum constraints to prevent cramped widgets
const DEFAULT_MIN_W = 3;
const DEFAULT_MIN_H = 2;

// Breakpoints matching Tailwind defaults
const BREAKPOINTS = { lg: 1024, md: 768, sm: 640, xs: 0 };
const COLS = { lg: 24, md: 12, sm: 6, xs: 2 };

interface DashboardGridProps {
    children: ReactNode;
    layouts: LayoutItem[];
    onLayoutChange?: (layout: LayoutItem[]) => void;
    isEditing?: boolean;
    /** @deprecated - rowHeight is now fixed at 70 */
    rowHeight?: number;
    /** @deprecated - cols is now responsive */
    cols?: number;
}

export function DashboardGrid({
    children,
    layouts,
    onLayoutChange,
    isEditing = true,
}: DashboardGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1200);

    // Measure container width with debounce to prevent excessive re-renders during animations
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        const updateWidth = () => {
            if (containerRef.current) {
                const newWidth = containerRef.current.offsetWidth;
                // Only update if width actually changed and not currently transitioning
                setWidth(newWidth);
            }
        };

        const debouncedUpdate = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(updateWidth, 100);
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(debouncedUpdate);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            clearTimeout(timeoutId);
        };
    }, []);


    // Generate responsive layouts from base layout
    const responsiveLayouts = useMemo(() => {
        const normalized = layouts.map(item => ({
            ...item,
            minW: item.minW ?? DEFAULT_MIN_W,
            minH: item.minH ?? DEFAULT_MIN_H,
        }));

        // Desktop (lg) - use original layout
        const lg = normalized;

        // Tablet (md) - 12 columns, scale down
        const md = normalized.map(item => ({
            ...item,
            x: Math.floor(item.x / 2),
            w: Math.min(Math.ceil(item.w / 2), 12),
            minW: Math.min(item.minW ?? DEFAULT_MIN_W, 6),
        }));

        // Mobile landscape (sm) - 6 columns, stack more
        const sm = normalized.map((item, index) => ({
            ...item,
            x: 0,
            y: index * (item.h || 4),
            w: 6,
            minW: 3,
        }));

        // Mobile portrait (xs) - 2 columns, full stack
        const xs = normalized.map((item, index) => ({
            ...item,
            x: 0,
            y: index * (item.h || 4),
            w: 2,
            minW: 2,
        }));

        return { lg, md, sm, xs };
    }, [layouts]);

    const [currentBreakpoint, setCurrentBreakpoint] = useState('lg');

    const handleLayoutChange = useCallback(
        (currentLayout: Layout, allLayouts: Partial<Record<string, Layout>>) => {
            // Only update with the desktop layout to maintain consistency
            if (currentBreakpoint === 'lg' && onLayoutChange && allLayouts.lg) {
                onLayoutChange(allLayouts.lg as unknown as LayoutItem[]);
            }
        },
        [currentBreakpoint, onLayoutChange]
    );

    const handleBreakpointChange = useCallback((breakpoint: string) => {
        setCurrentBreakpoint(breakpoint);
    }, []);

    const canEdit = isEditing && currentBreakpoint === 'lg';

    // All extra props that may not be in the type definitions
    const gridProps = {
        className: 'layout',
        layouts: responsiveLayouts,
        breakpoints: BREAKPOINTS,
        cols: COLS,
        rowHeight: 70,
        width,
        onLayoutChange: handleLayoutChange,
        onBreakpointChange: handleBreakpointChange,
        draggableHandle: '.widget-drag-handle',
        isDraggable: canEdit,
        isResizable: canEdit,
        compactType: 'vertical' as const,
        preventCollision: false,
        margin: [8, 8] as [number, number],
        containerPadding: [0, 0] as [number, number],
        useCSSTransforms: true,
    };

    return (
        <div ref={containerRef} className="dashboard-grid w-full">
            <Responsive {...gridProps}>
                {children}
            </Responsive>
        </div>
    );
}

// Legacy ResponsiveDashboardGrid for backwards compatibility
export function ResponsiveDashboardGrid(props: DashboardGridProps) {
    return <DashboardGrid {...props} />;
}
