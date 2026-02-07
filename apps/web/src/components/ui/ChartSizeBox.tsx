'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ChartSizeBoxProps {
  className?: string;
  minHeight?: number;
  fallback?: ReactNode;
  children: (size: { width: number; height: number }) => ReactNode;
}

export function ChartSizeBox({
  className,
  minHeight = 120,
  fallback,
  children,
}: ChartSizeBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const ready = size.width > 8 && size.height > 8;

  return (
    <div ref={ref} className={cn('w-full', className)} style={{ minHeight }}>
      {ready ? children(size) : (fallback ?? <div className="h-full w-full" />)}
    </div>
  );
}

export default ChartSizeBox;
