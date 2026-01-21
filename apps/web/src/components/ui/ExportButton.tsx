'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet, FileJson, FileText, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExportButtonProps {
  data: any[] | Record<string, any>;
  filename?: string;
  formats?: ('csv' | 'xlsx' | 'json')[];
  disabled?: boolean;
  className?: string;
}

export function ExportButton({ 
  data, 
  filename = 'export',
  formats = ['csv', 'json'],
  disabled = false,
  className = '',
}: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const exportCSV = () => {
    if (!data || (Array.isArray(data) && data.length === 0)) return;
    
    const items = Array.isArray(data) ? data : [data];
    const headers = Object.keys(items[0]);
    const csv = [
      headers.join(','),
      ...items.map(row => 
        headers.map(h => {
          const val = row[h];
          // Escape quotes and wrap in quotes if contains comma
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        }).join(',')
      )
    ].join('\n');
    
    downloadFile(csv, `${filename}.csv`, 'text/csv');
    showExported('csv');
  };

  const exportJSON = () => {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${filename}.json`, 'application/json');
    showExported('json');
  };

  const exportXLSX = async () => {
    // Lightweight TSV approach for Excel
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return;
    
    const headers = Object.keys(items[0]);
    const tsv = [
      headers.join('\t'),
      ...items.map(row => headers.map(h => row[h] ?? '').join('\t'))
    ].join('\n');
    
    downloadFile(tsv, `${filename}.xls`, 'application/vnd.ms-excel');
    showExported('xlsx');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showExported = (format: string) => {
    setExported(format);
    setTimeout(() => setExported(null), 2000);
    setIsOpen(false);
  };

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50"
        title="Export data"
      >
        {exported ? <Check className="w-3 h-3 text-green-500" /> : <Download className="w-3 h-3" />}
        <span>Export</span>
        <ChevronDown className="w-2 h-2 opacity-50" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 bg-[#1e293b] border border-[#334155] rounded-lg shadow-xl z-50 py-1 min-w-[100px]">
          {formats.includes('csv') && (
            <button
              onClick={exportCSV}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white text-left"
            >
              <FileText className="w-3 h-3" />
              CSV
            </button>
          )}
          {formats.includes('xlsx') && (
            <button
              onClick={exportXLSX}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white text-left"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Excel
            </button>
          )}
          {formats.includes('json') && (
            <button
              onClick={exportJSON}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white text-left"
            >
              <FileJson className="w-3 h-3" />
              JSON
            </button>
          )}
        </div>
      )}
    </div>
  );
}
