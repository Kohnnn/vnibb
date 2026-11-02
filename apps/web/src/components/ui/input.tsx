// Input component for VniBB Design System
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', ...props }, ref) => {
        return (
            <input
                ref={ref}
                className={`
          flex h-[var(--control-height)] w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]
          file:border-0 file:bg-transparent file:text-sm file:font-medium
          placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2
          focus-visible:outline-[var(--focus-ring-color)]
          focus-visible:border-[var(--color-accent-primary)]
          disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150
          ${className}
        `}
                {...props}
            />
        );
    }
);

Input.displayName = 'Input';
