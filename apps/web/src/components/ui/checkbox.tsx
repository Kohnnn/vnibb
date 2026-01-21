// Checkbox component for VNIBB Design System
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
                    onChange={(e) => onCheckedChange?.(e.target.checked)}
                    className={`
                        peer h-4 w-4 shrink-0 rounded border border-gray-700 bg-[#0d0d0d] 
                        text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 
                        disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200
                        appearance-none cursor-pointer checked:bg-blue-600 checked:border-blue-600
                        ${className}
                    `}
                    {...props}
                />
                <svg
                    className="absolute h-3 w-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100 left-0.5 top-0.5 transition-opacity duration-200"
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
