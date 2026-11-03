// Checkbox component for VniBB Design System
import React from 'react';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({ className = '', checked, onCheckedChange, ...props }, ref) => {
        return (
            <div className="relative flex items-center">
                <input
                    type="checkbox"
                    ref={ref}
                    checked={checked}
                    aria-label={props['aria-label']}
                    aria-labelledby={props['aria-labelledby']}
                    onChange={(e) => onCheckedChange?.(e.target.checked)}
                    className={`
                        peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-[var(--border-strong)] bg-[var(--bg-secondary)]
                        text-white transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]
                        disabled:cursor-not-allowed disabled:opacity-50
                        checked:border-[var(--color-accent-fill)] checked:bg-[var(--color-accent-fill)]
                        ${className}
                    `}
                    {...props}
                />
                <svg
                    className="absolute h-3 w-3 text-[var(--color-on-accent)] pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity duration-200"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="4"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            </div>
        );
    }
);

Checkbox.displayName = 'Checkbox';
