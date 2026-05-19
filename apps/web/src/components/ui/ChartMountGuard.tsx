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

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateReady = () => {
      const rect = element.getBoundingClientRect();
      // Require a stable, positive size that exceeds both thresholds. We do
      // NOT shrink-back to false once mounted: Recharts handles its own
      // resize via ResizeObserver, and re-mounting on every brief 0-width
      // transition would cause flicker.
      if (rect.width >= minWidth && rect.height >= Math.min(minHeight, 16)) {
        setIsReady(true);
      }
    };

    updateReady();
    const observer = new ResizeObserver(updateReady);
    observer.observe(element);

    return () => observer.disconnect();
  }, [minWidth, minHeight]);

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
