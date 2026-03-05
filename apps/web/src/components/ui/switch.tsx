'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
    ({ className, checked, onCheckedChange, onChange, ...props }, ref) => {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange?.(e)
            onCheckedChange?.(e.target.checked)
        }

        return (
            <label className={cn("relative inline-flex items-center cursor-pointer", className)}>
                <input
                    type="checkbox"
                    ref={ref}
                    checked={checked}
                    onChange={handleChange}
                    className="sr-only peer"
                    {...props}
                />
                <div className="peer h-6 w-11 rounded-full bg-[var(--bg-tertiary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--border-color)] after:bg-[var(--bg-elevated)] after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-[var(--text-primary)]" />
            </label>
        )
    }
)
Switch.displayName = "Switch"

export { Switch }
