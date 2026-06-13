'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import { BookMarked, Download, Trash2, ExternalLink, FileText } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import {
  readNotebookItems,
  removeNotebookItem,
  clearNotebook,
  notebookToMarkdown,
  RESEARCH_NOTEBOOK_EVENT,
  type NotebookItem,
} from '@/lib/researchNotebook';
import { exportToMarkdown } from '@/lib/exportWidget';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

interface ResearchNotebookWidgetProps {
  id?: string;
  widgetId?: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

const KIND_LABEL: Record<NotebookItem['kind'], string> = {
  news: 'News',
  widget_snapshot: 'Widget',
  agent_answer: 'VniAgent',
  note: 'Note',
};

function ResearchNotebookWidgetComponent({ id, widgetId, onRemove, onDataChange }: ResearchNotebookWidgetProps) {
  const [items, setItems] = useState<NotebookItem[]>([]);

  const refresh = useCallback(() => {
    setItems(readNotebookItems());
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener(RESEARCH_NOTEBOOK_EVENT, handler);
    return () => window.removeEventListener(RESEARCH_NOTEBOOK_EVENT, handler);
  }, [refresh]);

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: items.length === 0,
      apiGroup: 'local',
      endpoint: 'local:research-notebook',
      sourceLabel: 'Browser-local research notebook',
      extra: { count: items.length, localOnly: true },
    }))
  }, [items.length, onDataChange]);

  const handleExport = () => {
    if (!items.length) return;
    const markdown = notebookToMarkdown(items);
    exportToMarkdown(markdown, `vnibb-research-notebook-${new Date().toISOString().slice(0, 10)}`);
  };

  const handleClear = () => {
    clearNotebook();
    setItems([]);
  };

  return (
    <WidgetContainer
      title="Research Notebook"
      subtitle="Source-transparent · browser-local"
      widgetId={widgetId || id}
      onClose={onRemove}
      noPadding
      headerActions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={!items.length}
            className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            title="Export notebook as markdown"
          >
            <Download size={11} />
            Export
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!items.length}
            className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
            title="Clear notebook"
          >
            <Trash2 size={11} />
          </button>
        </div>
      }
    >
      {items.length === 0 ? (
        <WidgetEmpty
          icon={<BookMarked size={28} />}
          message="No pinned research yet"
          detail="Pin news items, widget snapshots, or VniAgent answers to build a source-transparent, exportable research note. Everything stays browser-local."
        />
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => (
            <div key={item.id} className="p-3 transition-colors hover:bg-[var(--bg-tertiary)]/30">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-200">
                  <FileText size={9} />
                  {KIND_LABEL[item.kind]}
                </span>
                {item.symbol && (
                  <span className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]">
                    {item.symbol}
                  </span>
                )}
                <span className="ml-auto text-[9px] text-[var(--text-muted)]" suppressHydrationWarning>
                  {new Date(item.createdAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => setItems(removeNotebookItem(item.id))}
                  className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-rose-300"
                  aria-label="Remove from notebook"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="text-[12px] font-semibold leading-snug text-[var(--text-primary)]">{item.title}</div>
              {item.body && (
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.body}</p>
              )}
              {item.sources && item.sources.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  {item.sources.map((source, index) => (
                    source.url ? (
                      <a
                        key={`${item.id}-src-${index}`}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-semibold hover:border-blue-400/50 hover:text-blue-300"
                      >
                        <ExternalLink size={9} />
                        {source.label || source.sourceName || 'Source'}
                      </a>
                    ) : null
                  ))}
                </div>
              )}
              {item.tags && item.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span key={`${item.id}-${tag}`} className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] uppercase text-[var(--text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}

export const ResearchNotebookWidget = memo(ResearchNotebookWidgetComponent);
export default ResearchNotebookWidget;
