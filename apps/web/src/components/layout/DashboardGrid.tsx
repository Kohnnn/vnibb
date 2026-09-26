'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Responsive, noCompactor } from 'react-grid-layout';
import type { Layout, ResponsiveProps } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { DASHBOARD_GRID_BREAKPOINTS } from '@/lib/responsive';
import { autoFitGridItems } from '@/lib/dashboardLayout';
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
    /** Optional widget type, used to resolve size contracts during responsive derivation. */
    type?: string;
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

/**
 * Grid contract (single source of truth):
 * - Columns: lg=24, md=12, sm=6, xs=2 (from the shared responsive breakpoints).
 * - rowHeight: 40px (passed by DashboardClient; the legacy "fixed at 70" note was wrong).
 * - Gap: 6/6/8/6 px per breakpoint.
 *
 * `lg` is the only PERSISTED layout. `md`/`sm`/`xs` are always *derived* from `lg`
 * at render time via the shared `autoFitGridItems` engine (see step 2/3), so there
 * is one packing algorithm instead of three ad-hoc transforms, and tablet/phone
 * never write back to the stored layout.
 */
const BREAKPOINTS = DASHBOARD_GRID_BREAKPOINTS;
const COLS = { lg: 24, md: 12, sm: 6, xs: 2 };
const GRID_GAP = { lg: 6, md: 6, sm: 8, xs: 6 } as const;

interface DashboardGridProps {
    children: any;
    layouts: LayoutItem[];
    onLayoutChange?: (layout: LayoutItem[]) => void;
    onEditableChange?: (canEdit: boolean) => void;
    isEditing?: boolean;
    /** Row height in grid units (px). Defaults to 40, the canonical value. */
    rowHeight?: number;
}

export function DashboardGrid({
    children,
    layouts,
    onLayoutChange,
    onEditableChange,
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


    // Generate responsive layouts from the persisted base (lg) layout.
    //
    // `lg` is authored/persisted as-is. `md`/`sm`/`xs` are DERIVED via the shared
    // `autoFitGridItems` engine (the same one used for add-widget + templates),
    // parameterized by each breakpoint's column count. Items are fed in current
    // visual order (y, then x) so the derived stack preserves the author's
    // reading order, and the engine applies each widget's size contract
    // (min/preferred W/H, orientation, expand priority) instead of naive halving.
    const responsiveLayouts = useMemo(() => {
        const normalized = layouts.map(item => ({
            ...item,
            minW: item.minW ?? DEFAULT_MIN_W,
            minH: item.minH ?? DEFAULT_MIN_H,
        }));

        // Desktop (lg) — use the persisted layout unchanged.
        const lg = normalized;

        // Order by current visual position so derivation preserves reading order.
        const ordered = [...normalized].sort((a, b) => a.y - b.y || a.x - b.x);

        // Pack the ordered items into `cols` columns using the shared engine, then
        // map the result back onto LayoutItem (carrying i/static/maxima through).
        const derive = (cols: number): LayoutItem[] => {
            const packed = autoFitGridItems(
                ordered.map(item => ({
                    type: item.type,
                    // Preserve identity + flags on the wrapper so we can restore them.
                    __i: item.i,
                    __static: item.static,
                    __maxW: item.maxW,
                    __maxH: item.maxH,
                    layout: {
                        x: item.x,
                        y: item.y,
                        w: item.w,
                        h: item.h,
                        minW: item.minW,
                        minH: item.minH,
                        maxW: item.maxW,
                        maxH: item.maxH,
                    },
                })),
                cols,
            );

            return packed.map((p) => {
                const wrapper = p as typeof p & {
                    __i: string;
                    __static?: boolean;
                    __maxW?: number;
                    __maxH?: number;
                };
                return {
                    i: wrapper.__i,
                    x: p.layout.x,
                    y: p.layout.y,
                    w: p.layout.w,
                    h: p.layout.h,
                    minW: p.layout.minW,
                    minH: p.layout.minH,
                    maxW: wrapper.__maxW,
                    maxH: wrapper.__maxH,
                    static: wrapper.__static,
                };
            });
        };

        return {
            lg,
            md: derive(COLS.md),
            sm: derive(COLS.sm),
            xs: derive(COLS.xs),
        };
    }, [layouts]);

    const [currentBreakpoint, setCurrentBreakpoint] = useState('lg');

    const persistInteraction = useCallback(
        (nextLayout: Layout) => {
            if (isEditing && currentBreakpoint === 'lg' && width >= BREAKPOINTS.lg) {
                onLayoutChange?.(nextLayout as LayoutItem[]);
            }
        },
        [currentBreakpoint, isEditing, onLayoutChange, width]
    );

    const handleBreakpointChange = useCallback((breakpoint: string) => {
        setCurrentBreakpoint(breakpoint);
    }, []);

    const gridSpacing = GRID_GAP[currentBreakpoint as keyof typeof GRID_GAP] ?? GRID_GAP.lg;
    const gridMargin: [number, number] = [gridSpacing, gridSpacing];

    // Editing is only allowed at `lg`, the single persisted layout. At md/sm/xs
    // the layout is derived (view-only), so drag/resize is disabled there to
    // avoid implying edits that won't be saved.
    const canEdit = isEditing && currentBreakpoint === 'lg' && width >= BREAKPOINTS.lg;
    useEffect(() => {
        onEditableChange?.(canEdit);
        return () => onEditableChange?.(false);
    }, [canEdit, onEditableChange]);

    // Nudge container-measuring embeds (Recharts/TradingView) to re-measure after
    // breakpoint/layout/width changes. Shared with DashboardClient via useResizeNudge.
    useResizeNudge([currentBreakpoint, layouts, rowHeight, width], 120);

    // View-only layouts retain the authored desktop coordinates, including deliberate
    // gaps. Responsive projections are disposable and never become saved geometry.
    const effectiveLayouts = useMemo(() => canEdit ? responsiveLayouts : {
        lg: responsiveLayouts.lg.map(item => ({ ...item, static: true })),
        md: responsiveLayouts.md.map(item => ({ ...item, static: true })),
        sm: responsiveLayouts.sm.map(item => ({ ...item, static: true })),
        xs: responsiveLayouts.xs.map(item => ({ ...item, static: true })),
    }, [canEdit, responsiveLayouts]);

    // Disable passive compaction in both modes: only a deliberate drag/resize or
    // the workspace's explicit auto-fit action may rewrite authored geometry.
    const gridProps = {
        className: 'layout',
        layouts: effectiveLayouts,
        breakpoints: BREAKPOINTS,
        cols: COLS,
        rowHeight,
        width,
        onBreakpointChange: handleBreakpointChange,
        onDragStop: persistInteraction,
        onResizeStop: persistInteraction,
        dragConfig: {
            enabled: canEdit,
            handle: '.widget-drag-handle',
            cancel: 'button, input, select, textarea, a, [role="dialog"], [data-dropdown-menu-content]',
        },
        resizeConfig: { enabled: canEdit, handles: ['se', 'e', 's'] },
        dropConfig: { enabled: false },
        compactor: noCompactor,
        margin: gridMargin,
        containerPadding: [0, 0] as [number, number],
    } satisfies Omit<ResponsiveProps, 'children'>;

    return (
        <div ref={containerRef} data-grid-editable={canEdit} className="dashboard-grid w-full">
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
