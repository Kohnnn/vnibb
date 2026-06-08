/**
 * Mobile Responsiveness Utilities
 * 
 * Provides:
 * - Responsive breakpoint hooks
 * - Mobile-specific layout helpers
 * - Touch-friendly component utilities
 */

'use client';

import { useEffect, useState } from 'react';

/**
 * Breakpoint definitions (matching Tailwind defaults)
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

type Breakpoint = keyof typeof breakpoints;

/**
 * Shared dashboard layout breakpoints — the single source of truth for the
 * responsive grid (DashboardGrid) and shell chrome (DashboardClient sidebars /
 * AI copilot overlay). Aligned to the Tailwind `breakpoints` scale above so the
 * grid column count and the sidebar visibility flip at the same widths (no
 * "multi-column grid but hidden sidebar" gap band).
 *
 * - `lg` (>=1024): full desktop, left sidebar visible, multi-column grid editing.
 * - `md` (>=768): tablet, scaled-down grid, still editable.
 * - `sm` (>=640) / `xs` (<640): stacked, static.
 *
 * `LEFT_SIDEBAR_HIDE_BELOW` intentionally equals the grid `lg` threshold.
 * `AI_COPILOT_OVERLAY_BELOW_WIDTH` / `_HEIGHT` keep the copilot docked only when
 * there is comfortable room; below that it overlays to protect workspace width.
 */
export const DASHBOARD_GRID_BREAKPOINTS = {
  lg: breakpoints.lg, // 1024
  md: breakpoints.md, // 768
  sm: breakpoints.sm, // 640
  xs: 0,
} as const;

export const LEFT_SIDEBAR_HIDE_BELOW = breakpoints.lg; // 1024
export const AI_COPILOT_OVERLAY_BELOW_WIDTH = 1480;
export const AI_COPILOT_OVERLAY_BELOW_HEIGHT = 840;

/**
 * Hook to detect current breakpoint
 */
export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState<Breakpoint | 'xs'>('lg');

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      
      if (width < breakpoints.sm) {
        setBreakpoint('xs');
      } else if (width < breakpoints.md) {
        setBreakpoint('sm');
      } else if (width < breakpoints.lg) {
        setBreakpoint('md');
      } else if (width < breakpoints.xl) {
        setBreakpoint('lg');
      } else if (width < breakpoints['2xl']) {
        setBreakpoint('xl');
      } else {
        setBreakpoint('2xl');
      }
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  return breakpoint;
}

/**
 * Hook to detect if viewport is mobile (< 768px)
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < breakpoints.md);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

/**
 * Hook to detect if viewport is tablet (768px - 1024px)
 */
export function useIsTablet() {
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const checkTablet = () => {
      const width = window.innerWidth;
      setIsTablet(width >= breakpoints.md && width < breakpoints.lg);
    };

    checkTablet();
    window.addEventListener('resize', checkTablet);
    return () => window.removeEventListener('resize', checkTablet);
  }, []);

  return isTablet;
}

/**
 * Hook to get viewport dimensions
 */
export function useViewport() {
  const [viewport, setViewport] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  return viewport;
}

/**
 * Responsive grid column calculator
 */
export function getResponsiveColumns(
  isMobile: boolean,
  isTablet: boolean
): number {
  if (isMobile) return 1;
  if (isTablet) return 2;
  return 3;
}

/**
 * Touch-friendly minimum size enforcement
 */
export const touchTarget = {
  minWidth: '44px',
  minHeight: '44px',
} as const;

/**
 * Mobile-optimized spacing
 */
export const mobileSpacing = {
  xs: '0.5rem',  // 8px
  sm: '0.75rem', // 12px
  md: '1rem',    // 16px
  lg: '1.5rem',  // 24px
  xl: '2rem',    // 32px
} as const;

/**
 * Get responsive font size
 */
export function getResponsiveFontSize(
  base: number,
  isMobile: boolean
): string {
  const scale = isMobile ? 0.875 : 1; // 87.5% on mobile
  return `${base * scale}rem`;
}

/**
 * Responsive padding helper
 */
export function getResponsivePadding(
  desktop: string,
  mobile?: string
): { desktop: string; mobile: string } {
  return {
    desktop,
    mobile: mobile || mobileSpacing.md,
  };
}
