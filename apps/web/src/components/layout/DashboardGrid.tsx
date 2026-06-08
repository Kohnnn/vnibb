'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Responsive } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { DASHBOARD_GRID_BREAKPOINTS } from '@/lib/responsive';
import { useResizeNudge } from '@/hooks/useResizeNudge';
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

// Breakpoints come from the shared responsive contract (`@/lib/responsive`) so the
// grid's column flip aligns with the shell sidebar visibility (no gap band).
const BREAKPOINTS = DASHBOARD_GRID_BREAKPOINTS;
const COLS = { lg: 24, md: 12, sm: 6, xs: 2 };
const GRID_GAP = { lg: 6, md: 6, sm: 8, xs: 6 } as const;

interface DashboardGridProps {
    children: any;
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
    isEditing = false,
    rowHeight = 40,
}: DashboardGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1200);

    // Measure container width with debounce to prevent excessive re-renders during animations
    useEffect(() => {
        let timeoutId: number | undefined;

        const updateWidth = (nextWidth?: number) => {
            const measuredWidth = nextWidth ?? containerRef.current?.getBoundingClientRect().width ?? 0;
            const roundedWidth = Math.round(measuredWidth);
            if (!Number.isFinite(roundedWidth) || roundedWidth <= 0) {
                return;
            }

            setWidth((currentWidth) => (currentWidth === roundedWidth ? currentWidth : roundedWidth));
        };

        const debouncedUpdate = (nextWidth?: number) => {
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
            timeoutId = window.setTimeout(() => updateWidth(nextWidth), 100);
        };

        updateWidth();

        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;

            const { width: nextWidth, height: nextHeight } = entry.contentRect;
            if (nextWidth <= 0 || nextHeight <= 0) {
                return;
            }

            debouncedUpdate(nextWidth);
        });
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
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
            if (!onLayoutChange) return;

            if (currentBreakpoint === 'lg' && allLayouts.lg) {
                onLayoutChange(allLayouts.lg as unknown as LayoutItem[]);
                return;
            }

            if (currentBreakpoint === 'md') {
                onLayoutChange(
                    currentLayout.map((item) => ({
                        ...item,
                        x: item.x * 2,
                        w: Math.min(item.w * 2, COLS.lg),
                        minW: item.minW ? Math.min(item.minW * 2, COLS.lg) : undefined,
                        maxW: item.maxW ? Math.min(item.maxW * 2, COLS.lg) : undefined,
                    })) as unknown as LayoutItem[]
                );
            }
        },
        [currentBreakpoint, onLayoutChange]
    );

    const handleBreakpointChange = useCallback((breakpoint: string) => {
        setCurrentBreakpoint(breakpoint);
    }, []);

    const gridSpacing = GRID_GAP[currentBreakpoint as keyof typeof GRID_GAP] ?? GRID_GAP.lg;
    const gridMargin: [number, number] = [gridSpacing, gridSpacing];

    const canEdit = isEditing && (currentBreakpoint === 'lg' || currentBreakpoint === 'md');
    const draggableHandle = canEdit ? '.widget-drag-handle' : undefined;

    // Nudge container-measuring embeds (Recharts/TradingView) to re-measure after
    // breakpoint/layout/width changes. Shared with DashboardClient via useResizeNudge.
    useResizeNudge([currentBreakpoint, layouts, rowHeight, width], 120);

    const effectiveLayouts = useMemo(() => {
        if (canEdit) return responsiveLayouts;

        const toStatic = (items?: LayoutItem[]) =>
            (items || []).map((item) => ({
                ...item,
                static: true,
            }));

        return {
            lg: toStatic(responsiveLayouts.lg),
            md: toStatic(responsiveLayouts.md),
            sm: toStatic(responsiveLayouts.sm),
            xs: toStatic(responsiveLayouts.xs),
        };
    }, [canEdit, responsiveLayouts]);

    // All extra props that may not be in the type definitions
    //
    // compactType decision: while the user is editing we keep `'vertical'`
    // to give the familiar drag-and-drop reflow. For non-editable / static
    // system dashboards we disable compaction (compactType=null). Without
    // this, an empty widget runtime hint shrinking a cell would cascade
    // through the whole tab via vertical compaction, producing the
    // "widgets collide / blank top-left when zooming" behaviour.
    //
    // preventCollision is left at the RGL default (false) regardless of
    // edit mode. Setting it to true on static layouts caused widgets that
    // momentarily overlapped during breakpoint transitions to refuse to
    // render, which felt like the dashboard was breaking on resize.
    const gridProps = {
        className: 'layout',
        layouts: effectiveLayouts,
        breakpoints: BREAKPOINTS,
        cols: COLS,
        rowHeight,
        width,
        onLayoutChange: handleLayoutChange,
        onBreakpointChange: handleBreakpointChange,
        draggableHandle,
        isDraggable: canEdit,
        isResizable: canEdit,
        resizeHandles: canEdit ? ['se', 'e', 's'] : undefined,
        isDroppable: false,
        compactType: (canEdit ? 'vertical' : null) as 'vertical' | null,
        preventCollision: false,
        margin: gridMargin,
        containerPadding: [0, 0] as [number, number],
        useCSSTransforms: true,
    };

    return (
        <div ref={containerRef} className="dashboard-grid w-full">
            <Responsive {...gridProps}>
                {children as any}
            </Responsive>
        </div>
    );
}

// Legacy ResponsiveDashboardGrid for backwards compatibility
export function ResponsiveDashboardGrid(props: DashboardGridProps) {
    return <DashboardGrid {...props} />;
}
