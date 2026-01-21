/**
 * Skeleton Loader Component
 * 
 * Loading placeholder with shimmer animation
 * Used while widgets fetch data
 */

import React from 'react';

export interface SkeletonProps {
    variant?: 'text' | 'rect' | 'circle';
    width?: string | number;
    height?: string | number;
    className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
    variant = 'text',
    width,
    height,
    className = '',
}) => {
    const variantClasses = {
        text: 'skeleton-text',
        rect: 'skeleton-rect',
        circle: 'skeleton-circle',
    };

    const style: React.CSSProperties = {
        width: width || (variant === 'text' ? '100%' : undefined),
        height: height || (variant === 'text' ? '1em' : undefined),
    };

    return (
        <div
            className={`skeleton ${variantClasses[variant]} ${className}`}
            style={style}
        />
    );
};

/**
 * Table Skeleton Loader
 */
export interface TableSkeletonProps {
    rows?: number;
    columns?: number;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
    rows = 5,
    columns = 4,
}) => {
    return (
        <div className="skeleton-table">
            {/* Header */}
            <div className="skeleton-table__header">
                {Array.from({ length: columns }).map((_, i) => (
                    <Skeleton key={i} variant="text" height="20px" />
                ))}
            </div>
            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="skeleton-table__row">
                    {Array.from({ length: columns }).map((_, colIndex) => (
                        <Skeleton key={colIndex} variant="text" height="16px" />
                    ))}
                </div>
            ))}
        </div>
    );
};

/**
 * Chart Skeleton Loader
 */
export const ChartSkeleton: React.FC = () => {
    return (
        <div className="skeleton-chart">
            <div className="skeleton-chart__bars">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={i}
                        className="skeleton-chart__bar"
                        style={{
                            height: `${Math.random() * 60 + 20}%`,
                            animationDelay: `${i * 50}ms`,
                        }}
                    />
                ))}
            </div>
            <div className="skeleton-chart__x-axis">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} variant="text" width="40px" height="12px" />
                ))}
            </div>
        </div>
    );
};

/**
 * Card Skeleton Loader
 */
export const CardSkeleton: React.FC = () => {
    return (
        <div className="skeleton-card">
            <Skeleton variant="text" width="60%" height="24px" />
            <Skeleton variant="text" width="40%" height="16px" />
            <div style={{ marginTop: '16px' }}>
                <Skeleton variant="text" width="100%" />
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="90%" />
            </div>
        </div>
    );
};
