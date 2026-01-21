'use client'

import * as React from "react"
import { cn } from "@/lib/utils"

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'defaultValue'> {
    value?: number[]
    defaultValue?: number[]
    onValueChange?: (value: number[]) => void
    min?: number
    max?: number
    step?: number
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
    ({ className, value, defaultValue, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
        const [internalValue, setInternalValue] = React.useState(defaultValue?.[0] ?? value?.[0] ?? 0)
        
        const currentValue = value?.[0] ?? internalValue
        
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = Number(e.target.value)
            setInternalValue(newValue)
            onValueChange?.([newValue])
        }

        return (
            <div className={cn("relative flex w-full touch-none select-none items-center", className)}>
                <input
                    type="range"
                    ref={ref}
                    value={currentValue}
                    onChange={handleChange}
                    min={min}
                    max={max}
                    step={step}
                    className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    {...props}
                />
            </div>
        )
    }
)
Slider.displayName = "Slider"

export { Slider }
