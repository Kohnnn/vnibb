'use client';

/**
 * VniAgent diagnostics: read-only MCP tool catalog.
 *
 * Surfaces the `vnibb-mcp` read-only tool surface with an explicit permission
 * taxonomy so users (and, by extension, agent transparency) can see exactly
 * which tools VniAgent can call and that none of them write/mutate. Sourced from
 * the static descriptor in `lib/mcpToolCatalog.ts` (mirrors
 * docs/VNIBB_MCP_READONLY.md). This panel never executes any tool.
 */

import { useMemo, useState } from 'react';
import { ShieldCheck, KeyRound, Database, Server, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MCP_TOOL_CATALOG,
  MCP_PERMISSION_LABELS,
  MCP_EXCLUDED_CAPABILITIES,
  type McpPermissionClass,
  type McpToolSource,
} from '@/lib/mcpToolCatalog';

const PERMISSION_STYLE: Record<McpPermissionClass, string> = {
  read_only: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  authenticated_read: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  confirm_action: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

const SOURCE_LABEL: Record<McpToolSource, string> = {
  app_collections: 'App collections',
  analytical_corpus: 'Analytical corpus',
};

function PermissionBadge({ permission }: { permission: McpPermissionClass }) {
  const Icon = permission === 'read_only' ? ShieldCheck : permission === 'authenticated_read' ? KeyRound : Lock;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]',
        PERMISSION_STYLE[permission],
      )}
      title={MCP_PERMISSION_LABELS[permission].detail}
    >
      <Icon size={10} />
      {MCP_PERMISSION_LABELS[permission].label}
    </span>
  );
}

export function McpToolCatalogPanel() {
  const [sourceFilter, setSourceFilter] = useState<'all' | McpToolSource>('all');

  const tools = useMemo(
    () => (sourceFilter === 'all' ? MCP_TOOL_CATALOG : MCP_TOOL_CATALOG.filter((t) => t.source === sourceFilter)),
    [sourceFilter],
  );

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-[var(--accent-blue)]" />
          <h4 className="text-sm font-bold text-[var(--text-primary)]">VniAgent tools (read-only MCP)</h4>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
          <ShieldCheck size={11} />
          Read-only
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
        These are the curated <span className="font-mono">vnibb-mcp</span> tools VniAgent can read from. No write,
        delete, admin, or sync tools are exposed.
      </p>

      <div className="mt-3 flex items-center gap-1">
        {(['all', 'app_collections', 'analytical_corpus'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSourceFilter(value)}
            className={cn(
              'rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors',
              sourceFilter === value
                ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                : 'border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {value === 'all' ? 'All' : SOURCE_LABEL[value]}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-semibold text-[var(--text-primary)]">{tool.name}</span>
              <PermissionBadge permission={tool.permission} />
            </div>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{tool.description}</p>
            <div className="mt-1 flex items-center gap-2 text-[9px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1">
                <Database size={9} className="opacity-70" />
                {SOURCE_LABEL[tool.source]}
              </span>
              {tool.sampleInput && (
                <span className="font-mono opacity-70">{JSON.stringify(tool.sampleInput)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300/90">
          <Lock size={10} />
          Intentionally not exposed
        </div>
        <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-[var(--text-muted)]">
          {MCP_EXCLUDED_CAPABILITIES.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default McpToolCatalogPanel;
