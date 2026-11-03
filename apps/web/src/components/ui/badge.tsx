import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "secondary" | "destructive" | "outline"
}

/* Solid token surfaces (#199): no translucent primary/secondary fills and no
   glow. `destructive` is a system state, so it uses the neutral state tokens
   rather than red — red stays reserved for financial direction. */
function Badge({ className, variant = "default", ...props }: BadgeProps) {
    const variants = {
        default: "border-transparent bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]",
        secondary: "border-[var(--border-strong)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        destructive: "border-[var(--color-state-border)] bg-[var(--color-state-bg)] text-[var(--color-error)]",
        outline: "border-[var(--border-strong)] text-[var(--text-primary)]",
    }

    return (
        <div
            className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]",
                variants[variant],
                className
            )}
            {...props}
        />
    )
}

export { Badge }
