'use client';

import { useState } from 'react';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PerformanceData {
  symbol: string;
  name: string;
  price: number;
  perf_1d: number;
  perf_1w: number;
  perf_1m: number;
  perf_3m: number;
  perf_6m: number;
  perf_ytd: number;
  perf_1y: number;
}

const TIMEFRAME_COLUMNS = [
  { key: 'perf_1d', label: '1D' },
  { key: 'perf_1w', label: '1W' },
  { key: 'perf_1m', label: '1M' },
  { key: 'perf_3m', label: '3M' },
  { key: 'perf_6m', label: '6M' },
  { key: 'perf_ytd', label: 'YTD' },
  { key: 'perf_1y', label: '1Y' },
];

interface PerformanceTableProps {
  data: PerformanceData[];
}

export function PerformanceTable({ data }: PerformanceTableProps) {
  const [sortColumn, setSortColumn] = useState<string>('perf_1d');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedData = [...data].sort((a, b) => {
    const aVal = a[sortColumn as keyof PerformanceData] as number || 0;
    const bVal = b[sortColumn as keyof PerformanceData] as number || 0;
    return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
  });

  const toggleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  return (
    <div className="h-full overflow-auto scrollbar-hide">
      <table className="data-table w-full text-[11px] border-separate border-spacing-0">
        <thead className="sticky top-0 z-10 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm">
          <tr>
            <th className="w-[180px] border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2 text-left font-bold uppercase tracking-tighter text-[var(--text-muted)]">Symbol</th>
            <th className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-right font-bold uppercase tracking-tighter text-[var(--text-muted)]">Price</th>
            {TIMEFRAME_COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="cursor-pointer border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-right font-bold uppercase tracking-tighter text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex items-center justify-end gap-1">
                  {col.label}
                  {sortColumn === col.key ? (
                      sortDirection === 'desc' ? <ArrowDown size={10} className="text-blue-400" /> : <ArrowUp size={10} className="text-blue-400" />
                  ) : <ArrowUpDown size={10} className="opacity-20" />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {sortedData.map((row, index) => (
            <tr key={`${row.symbol}-${index}`} className="group transition-colors hover:bg-[var(--bg-tertiary)]">
              <td className="border-r border-[var(--border-subtle)] px-4 py-2">
                <div className="flex items-center gap-2">
                  <CompanyLogo symbol={row.symbol} size={20} />
                  <div>
                    <div className="font-bold tracking-tight text-[var(--text-primary)]">{row.symbol}</div>
                    <div className="max-w-[110px] truncate text-[9px] font-medium uppercase tracking-tighter text-[var(--text-muted)]">{row.name}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                {row.price.toLocaleString()}
              </td>
              {TIMEFRAME_COLUMNS.map(col => {
                const value = row[col.key as keyof PerformanceData] as number;
                const isPositive = value > 0;
                const isNegative = value < 0;
                
                return (
                  <td
                    key={col.key}
                    className={cn(
                        "text-right px-3 py-2 font-mono font-medium",
                        isPositive ? 'bg-green-500/5 text-green-500' : isNegative ? 'bg-red-500/5 text-red-500' : 'text-[var(--text-muted)]'
                    )}
                  >
                    {isPositive ? '+' : ''}{value?.toFixed(2)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
