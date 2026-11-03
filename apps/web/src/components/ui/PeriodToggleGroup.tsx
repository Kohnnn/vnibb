'use client';

import { useState } from 'react';

interface PeriodToggleGroupProps {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
}

export function PeriodToggleGroup({
  value,
  onChange,
  options = ['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM']
}: PeriodToggleGroupProps) {
  return (
    <div className="flex gap-0.5 rounded-md bg-[var(--bg-secondary)] p-0.5">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] ${
            value === option
              ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
