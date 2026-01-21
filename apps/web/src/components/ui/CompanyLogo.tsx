'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CompanyLogoProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function CompanyLogo({ symbol, size = 24, className = '' }: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);
  
  // Use a fallback-friendly logo service
  // Clearbit often works for major tickers, or we can use a generic stock logo service
  const logoUrl = `https://logo.clearbit.com/${symbol.toLowerCase()}.com.vn`;
  
  return (
    <div 
      className={cn(
          "flex items-center justify-center bg-gray-800 rounded-md overflow-hidden flex-shrink-0 border border-gray-700/50",
          className
      )}
      style={{ width: size, height: size }}
    >
      {!hasError ? (
        <img
          src={logoUrl}
          alt={symbol}
          width={size}
          height={size}
          className="object-contain"
          onError={() => setHasError(true)}
        />
      ) : (
        <div 
          className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900"
        >
            <span className="text-[10px] font-black text-white/40">{symbol.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}
