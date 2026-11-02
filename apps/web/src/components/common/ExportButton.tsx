import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';

/**
 * Backend export trigger (CSV / Excel). The server renders the file, so this
 * button only forwards the format; `lib/exportWidget.ts` provenance applies to
 * the client-side exporters, not here.
 */
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
    const [failed, setFailed] = useState(false);
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
        setFailed(false);
        try {
            await onExport(format);
        } catch (error) {
            console.error('Export failed:', error);
            setFailed(true);
        }
    };

    // Base styles
    const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

    // Variants
    const variants = {
        outline: "border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]",
        default: "border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        ghost: "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
        secondary: "border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]",
    };

    // Sizes
    const sizes = {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6 text-sm",
        icon: "h-8 w-8 p-0",
    };

    // Resolve styles (fallback to simple tailwind if vars not defined)
    const variantClass =
        variants[variant] ||
        "border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]";
    const sizeClass = sizes[size] || "h-8 px-3 text-xs";

    return (
        <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsOpen(!isOpen);
                    }
                }}
                disabled={isLoading}
                className={`${baseStyles} ${variantClass} ${sizeClass} ${className}`}
                type="button"
                aria-label="Export options"
                aria-expanded={isOpen}
            >
                <Download className="mr-2 h-4 w-4" />
                Export
                <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
            </button>

            {isOpen && (
                <div className="absolute right-0 z-50 mt-2 w-40 origin-top-right rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-lg ring-1 ring-[rgba(0,0,0,0.05)] focus:outline-none">
                    <div className="py-1">
                        <button
                            onClick={() => handleExport('csv')}
                            className="block w-full px-4 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                        >
                            Export as CSV
                        </button>
                        <button
                            onClick={() => handleExport('excel')}
                            className="block w-full px-4 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                        >
                            Export as Excel
                        </button>
                    </div>
                </div>
            )}

            {failed && (
                <p role="alert" className="mt-1 text-[10px] text-[var(--color-error)]">
                    Export failed. Try again.
                </p>
            )}
        </div>
    );
}
