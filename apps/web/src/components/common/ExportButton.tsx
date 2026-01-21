
import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';

interface ExportButtonProps {
    onExport: (format: 'csv' | 'excel') => Promise<void>;
    isLoading?: boolean;
    className?: string;
    variant?: 'outline' | 'default' | 'ghost' | 'secondary';
    size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function ExportButton({
    onExport,
    isLoading = false,
    className = '',
    variant = 'outline',
    size = 'sm'
}: ExportButtonProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [dropdownRef]);

    const handleExport = async (format: 'csv' | 'excel') => {
        setIsOpen(false);
        try {
            await onExport(format);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed. Please check console for details.');
        }
    };

    // Base styles
    const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

    // Variants
    const variants = {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
    };

    // Sizes
    const sizes = {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
    };

    // Resolve styles (fallback to simple tailwind if vars not defined)
    const variantClass = variants[variant] || "border border-gray-700 bg-transparent hover:bg-gray-800 text-gray-300";
    const sizeClass = sizes[size] || "h-8 px-3 text-xs";

    return (
        <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                disabled={isLoading}
                className={`${baseStyles} ${variantClass} ${sizeClass} ${className}`}
                type="button"
            >
                <Download className="mr-2 h-4 w-4" />
                Export
            </button>

            {isOpen && (
                <div className="absolute right-0 z-50 mt-2 w-40 origin-top-right rounded-md border border-gray-700 bg-[#0b1021] shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="py-1">
                        <button
                            onClick={() => handleExport('csv')}
                            className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                        >
                            Export as CSV
                        </button>
                        <button
                            onClick={() => handleExport('excel')}
                            className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                        >
                            Export as Excel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
