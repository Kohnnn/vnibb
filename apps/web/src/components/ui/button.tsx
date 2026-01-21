// Button component for VNIBB Design System
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = '', variant = 'primary', size = 'md', ...props }, ref) => {
        const baseStyles = 'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

        const variants = {
            primary: 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20',
            secondary: 'bg-gray-800 text-gray-200 hover:bg-gray-700',
            outline: 'bg-transparent border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white',
            ghost: 'bg-transparent text-gray-400 hover:text-white hover:bg-gray-800/50',
            danger: 'bg-red-600/10 text-red-500 border border-red-500/20 hover:bg-red-600 hover:text-white',
        };

        const sizes = {
            sm: 'h-8 px-3 text-xs',
            md: 'h-10 px-4 text-sm',
            lg: 'h-12 px-6 text-base',
            icon: 'h-9 w-9 p-0',
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
