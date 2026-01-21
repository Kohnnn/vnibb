// Refined Select components for VNIBB Design System
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const SelectContext = createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
} | null>(null);

export const Select = ({ value, onValueChange, children }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <SelectContext.Provider value={{ value, onValueChange, isOpen, setIsOpen }}>
            <div ref={containerRef} className="relative w-full">
                {children}
            </div>
        </SelectContext.Provider>
    );
};

export const SelectTrigger = ({ className = '', children }: any) => {
    const context = useContext(SelectContext);
    if (!context) return null;

    return (
        <div
            onClick={() => context.setIsOpen(!context.isOpen)}
            className={`flex h-9 w-full items-center justify-between rounded-lg border border-gray-800 bg-[#0d0d0d] px-3 py-2 text-xs text-gray-200 cursor-pointer hover:border-gray-700 transition-all ${className}`}
        >
            <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {children}
            </div>
            <ChevronDown size={14} className={`ml-2 text-gray-500 transition-transform ${context.isOpen ? 'rotate-180' : ''}`} />
        </div>
    );
};

export const SelectValue = ({ placeholder }: any) => {
    const context = useContext(SelectContext);
    return <span>{context?.value || placeholder}</span>;
};

export const SelectContent = ({ children, className = '' }: any) => {
    const context = useContext(SelectContext);
    if (!context?.isOpen) return null;

    return (
        <div className={`absolute z-50 mt-1 w-full min-w-[12rem] max-h-64 overflow-y-auto rounded-lg border border-gray-800 bg-[#0a0a0a] shadow-2xl animate-in fade-in zoom-in-95 duration-200 custom-scrollbar ${className}`}>
            <div className="p-1">{children}</div>
        </div>
    );
};

export const SelectItem = ({ children, value, className = '' }: any) => {
    const context = useContext(SelectContext);
    if (!context) return null;

    const isSelected = context.value === value;

    return (
        <div
            onClick={() => {
                context.onValueChange?.(value);
                context.setIsOpen(false);
            }}
            className={`relative flex w-full cursor-pointer select-none items-center rounded-md py-2 px-3 text-xs outline-none transition-colors duration-150 ${isSelected ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                } ${className}`}
        >
            <span className="flex-1">{children}</span>
            {isSelected && <Check size={12} className="ml-2" />}
        </div>
    );
};
