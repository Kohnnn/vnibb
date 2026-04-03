'use client';

import type { CopilotTableArtifact } from '@/lib/api';

interface CopilotArtifactPanelProps {
  artifacts: CopilotTableArtifact[];
}

function formatArtifactValue(value: string | number | null | undefined, kind?: CopilotTableArtifact['columns'][number]['kind']): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value !== 'number') {
    return String(value);
  }

  if (kind === 'percent') {
    return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
  }

  if (kind === 'currency' || kind === 'large_number') {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    });
  }

  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

export function CopilotArtifactPanel({ artifacts }: CopilotArtifactPanelProps) {
  if (!artifacts.length) {
    return null;
  }

  return (
    <div className="space-y-3">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">{artifact.title}</div>
              {artifact.description && (
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{artifact.description}</div>
              )}
            </div>
            {artifact.sourceIds?.length ? (
              <div className="text-[10px] text-blue-300">{artifact.sourceIds.length} source refs</div>
            ) : null}
          </div>

          <div className="mt-3 overflow-auto">
            <table className="data-table w-full min-w-[560px] text-[10px] border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <tr>
                  {artifact.columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-2 py-2 font-medium ${column.kind === 'text' || !column.kind ? 'text-left' : 'text-right'}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {artifact.rows.map((row, rowIndex) => (
                  <tr key={`${artifact.id}-${rowIndex}`} className="hover:bg-[var(--bg-hover)]/70">
                    {artifact.columns.map((column) => (
                      <td
                        key={`${artifact.id}-${rowIndex}-${column.key}`}
                        className={`px-2 py-1.5 ${column.kind === 'text' || !column.kind ? 'text-left text-[var(--text-secondary)]' : 'text-right font-mono text-[var(--text-primary)]'}`}
                      >
                        {formatArtifactValue(row[column.key], column.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default CopilotArtifactPanel
