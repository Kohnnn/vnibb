// Button component for VniBB Design System
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg' | 'icon';
}

/**
 * Shared focus ring: 2 px ring with 2 px offset (brand pack §Keyboard focus).
 * The ring is drawn outside the control so it reads on every surface.
 */
export const focusRing =
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]';

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = '', variant = 'primary', size = 'md', ...props }, ref) => {
        const baseStyles = `inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 ${focusRing} disabled:opacity-50 disabled:pointer-events-none`;

        // Solid, flat surfaces. No glow, no glass, no scale-on-press.
        const variants = {
            primary: 'bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]',
            secondary:
                'border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
            outline:
                'border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
            ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
            // Destructive is a system action, not financial direction: neutral
            // accent surface with an explicit label, never red/green (#197).
            danger:
                'border border-[var(--border-strong)] bg-[var(--color-state-bg)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
        };

        const sizes = {
            sm: 'h-[var(--control-height-sm)] px-3 text-xs',
            md: 'h-[var(--control-height)] px-4 text-sm',
            lg: 'h-[var(--control-height-lg)] px-6 text-base',
            icon: 'h-[var(--control-height)] w-[var(--control-height)] p-0',
        };

        return (
            <button
                ref={ref}
                className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
                {...props}
            />
        );
    }
);

Button.displayName = 'Button';
