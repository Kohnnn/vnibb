// Input component for VNIBB Design System
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', ...props }, ref) => {
        return (
            <input
                ref={ref}
                className={`
          flex h-10 w-full rounded-lg border border-gray-800 bg-[#0d0d0d] px-3 py-2 text-sm text-gray-200 
          file:border-0 file:bg-transparent file:text-sm file:font-medium 
          placeholder:text-gray-600 focus-visible:outline-none focus-visible:ring-2 
          focus-visible:ring-blue-500/50 focus-visible:border-blue-500/50 
          disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200
          ${className}
        `}
                {...props}
            />
        );
    }
);

Input.displayName = 'Input';
