'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsContextValue {
    value: string
    onValueChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined)

function useTabsContext() {
    const context = React.useContext(TabsContext)
    if (!context) {
        throw new Error("Tabs components must be used within a Tabs provider")
    }
    return context
}

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
    defaultValue?: string
    value?: string
    onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
    ({ className, defaultValue, value: controlledValue, onValueChange, children, ...props }, ref) => {
        const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? "")
        
        const isControlled = controlledValue !== undefined
        const value = isControlled ? controlledValue : uncontrolledValue
        
        const handleValueChange = React.useCallback((newValue: string) => {
            if (!isControlled) {
                setUncontrolledValue(newValue)
            }
            onValueChange?.(newValue)
        }, [isControlled, onValueChange])

        return (
            <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
                <div ref={ref} className={cn("", className)} {...props}>
                    {children}
                </div>
            </TabsContext.Provider>
        )
    }
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "inline-flex h-[var(--control-height)] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-1 text-[var(--text-secondary)]",
                className
            )}
            {...props}
        />
    )
)
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
    ({ className, value, ...props }, ref) => {
        const { value: selectedValue, onValueChange } = useTabsContext()
        const isSelected = selectedValue === value

        return (
            <button
                ref={ref}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-state={isSelected ? "active" : "inactive"}
                className={cn(
                    "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] disabled:pointer-events-none disabled:opacity-50",
                    isSelected && "bg-[var(--bg-primary)] font-semibold text-[var(--text-primary)] shadow-sm ring-1 ring-inset ring-[var(--border-strong)]",
                    className
                )}
                onClick={() => onValueChange(value)}
                {...props}
            />
        )
    }
)
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
    ({ className, value, ...props }, ref) => {
        const { value: selectedValue } = useTabsContext()
        
        if (selectedValue !== value) {
            return null
        }

        return (
            <div
                ref={ref}
                role="tabpanel"
                data-state={selectedValue === value ? "active" : "inactive"}
                className={cn(
                    "mt-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]",
                    className
                )}
                {...props}
            />
        )
    }
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
