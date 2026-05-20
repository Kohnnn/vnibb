'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ChartMountGuardProps {
  children: ReactNode;
  className?: string;
  minHeight?: number;
  /**
   * Minimum measured width (px) before the chart is allowed to mount.
   * Recharts emits `width(-1) height(-1)` warnings when its parent transitions
   * through a near-zero width during grid resize / breakpoint changes; gating
   * mount on a non-trivial width avoids that path entirely.
   */
  minWidth?: number;
  fallback?: ReactNode;
}

export function ChartMountGuard({
  children,
  className,
  minHeight = 120,
  minWidth = 32,
  fallback,
}: ChartMountGuardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  // Two-way unmount: if the container shrinks below the threshold (e.g. tab
  // switched display:none, sidebar collapse animation) we re-mount Recharts
  // afresh on the next valid size. The earlier one-way version still let
  // Recharts emit width(-1) warnings during resize because the chart kept
  // trying to render at zero size. Debounced through a short timeout to
  // avoid flicker on transient transitions.

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let stableTimer: number | null = null;
    let unmountTimer: number | null = null;

    const updateReady = () => {
      const rect = element.getBoundingClientRect();
      const wide = rect.width >= minWidth;
      const tall = rect.height >= Math.min(minHeight, 16);

      if (wide && tall) {
        if (unmountTimer !== null) {
          window.clearTimeout(unmountTimer);
          unmountTimer = null;
        }
        if (!isReady) {
          if (stableTimer !== null) window.clearTimeout(stableTimer);
          stableTimer = window.setTimeout(() => setIsReady(true), 50);
        }
      } else {
        if (stableTimer !== null) {
          window.clearTimeout(stableTimer);
          stableTimer = null;
        }
        if (isReady) {
          if (unmountTimer !== null) window.clearTimeout(unmountTimer);
          unmountTimer = window.setTimeout(() => setIsReady(false), 250);
        }
      }
    };

    updateReady();
    const observer = new ResizeObserver(updateReady);
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (stableTimer !== null) window.clearTimeout(stableTimer);
      if (unmountTimer !== null) window.clearTimeout(unmountTimer);
    };
  }, [minWidth, minHeight, isReady]);

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      style={{ minHeight }}
    >
      {isReady ? children : (fallback ?? <div className="h-full w-full" />)}
    </div>
  );
}

export default ChartMountGuard;
