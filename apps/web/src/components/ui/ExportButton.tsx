'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet, FileJson, FileText, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportToCSV, exportToJSON, exportToXLSX, type ExportProvenance } from '@/lib/exportWidget';

interface ExportButtonProps {
  data: any[] | Record<string, any>;
  filename?: string;
  formats?: ('csv' | 'xlsx' | 'json')[];
  disabled?: boolean;
  className?: string;
  /** Source/retrieval metadata stamped into every file this button produces. */
  provenance?: ExportProvenance;
}

export function ExportButton({ 
  data, 
  filename = 'export',
  formats = ['csv', 'json'],
  disabled = false,
  className = '',
  provenance,
}: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const exportCSV = () => {
    if (!data || (Array.isArray(data) && data.length === 0)) return;
    exportToCSV(data, filename, provenance);
    showExported('csv');
  };

  const exportJSON = () => {
    exportToJSON(data, filename, provenance);
    showExported('json');
  };

  const exportXLSX = () => {
    if (!data || (Array.isArray(data) && data.length === 0)) return;
    exportToXLSX(data, filename, provenance);
    showExported('xlsx');
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        disabled={disabled}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors disabled:opacity-50"
        title="Export data"
        aria-label="Export data"
      >
        {exported ? <Check className="h-3 w-3 text-[var(--color-info)]" /> : <Download className="w-3 h-3" />}
        <span>Export</span>
        <ChevronDown className="w-2 h-2 opacity-50" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 bg-[var(--bg-dropdown)] border border-[var(--border-default)] rounded-md shadow-xl z-50 py-1 min-w-[100px]">
          {formats.includes('csv') && (
            <button
              onClick={exportCSV}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] text-left"
            >
              <FileText className="w-3 h-3" />
              CSV
            </button>
          )}
          {formats.includes('xlsx') && (
            <button
              onClick={exportXLSX}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] text-left"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Excel
            </button>
          )}
          {formats.includes('json') && (
            <button
              onClick={exportJSON}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] text-left"
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
