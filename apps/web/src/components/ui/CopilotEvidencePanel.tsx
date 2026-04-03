'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';

import type { CopilotSourceRef } from '@/lib/api';
import { cn } from '@/lib/utils';

interface CopilotEvidencePanelProps {
  sources: CopilotSourceRef[];
  className?: string;
}

function formatSourceMeta(source: CopilotSourceRef): string {
  const parts: string[] = [];
  if (source.source) {
    parts.push(source.source);
  }
  if (source.symbol) {
    parts.push(source.symbol);
  }
  if (source.asOf) {
    parts.push(`as of ${source.asOf}`);
  }
  return parts.join(' · ');
}

export function CopilotEvidencePanel({ sources, className }: CopilotEvidencePanelProps) {
  const orderedSources = useMemo(
    () => [...sources].sort((left, right) => (left.priority ?? 999) - (right.priority ?? 999)),
    [sources],
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(orderedSources[0]?.id ?? null);

  useEffect(() => {
    if (!orderedSources.length) {
      setSelectedSourceId(null);
      return;
    }
    if (!selectedSourceId || !orderedSources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(orderedSources[0].id);
    }
  }, [orderedSources, selectedSourceId]);

  if (!orderedSources.length) {
    return null;
  }

  const selectedSource = orderedSources.find((source) => source.id === selectedSourceId) ?? orderedSources[0];

  return (
    <div className={cn('rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-2">
          <Database size={12} className="text-blue-400" />
          <span className="font-semibold uppercase tracking-wide">Evidence</span>
          <span className="text-[10px] text-[var(--text-muted)]">{orderedSources.length} validated sources</span>
        </span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {orderedSources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedSourceId(source.id)}
                className={cn(
                  'rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors',
                  source.id === selectedSource.id
                    ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                    : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                [{source.id}]
              </button>
            ))}
          </div>

          <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
            <div className="font-semibold text-[var(--text-primary)]">{selectedSource.label || selectedSource.kind || selectedSource.id}</div>
            <div className="mt-1 font-mono text-[10px] text-blue-300">[{selectedSource.id}]</div>
            {formatSourceMeta(selectedSource) && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">{formatSourceMeta(selectedSource)}</div>
            )}
            {selectedSource.kind && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">Type: {selectedSource.kind}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CopilotEvidencePanel
