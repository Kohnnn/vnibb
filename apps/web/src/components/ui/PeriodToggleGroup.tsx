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
    <div className="flex bg-gray-800/50 rounded-md p-0.5 gap-0.5">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
            value === option
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
