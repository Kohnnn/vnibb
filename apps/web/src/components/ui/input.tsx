// Input component for VniBB Design System
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', ...props }, ref) => {
        return (
            <input
                ref={ref}
                className={`
          flex h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] 
          file:border-0 file:bg-transparent file:text-sm file:font-medium 
          placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 
          focus-visible:ring-[var(--color-state-border)] focus-visible:border-[var(--color-accent-primary)] 
          disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200
          ${className}
        `}
                {...props}
            />
        );
    }
);

Input.displayName = 'Input';
