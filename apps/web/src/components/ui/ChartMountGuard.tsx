'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ChartMountGuardProps {
  children: ReactNode;
  className?: string;
  minHeight?: number;
  fallback?: ReactNode;
}

export function ChartMountGuard({
  children,
  className,
  minHeight = 120,
  fallback,
}: ChartMountGuardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateReady = () => {
      const rect = element.getBoundingClientRect();
      setIsReady(rect.width > 8 && rect.height > 8);
    };

    updateReady();
    const observer = new ResizeObserver(updateReady);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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
