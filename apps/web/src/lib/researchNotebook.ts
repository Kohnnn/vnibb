'use client'

/**
 * Browser-local source-transparent research notebook.
 *
 * Phase 1 (Fincept/Quantcept-inspired) durable-research artifact: users can pin
 * news items, widget snapshots, and VniAgent conclusions into a notebook and
 * export it as source-preserving markdown. Local-first by design; a backend
 * notebook store can come later if durable sharing is justified.
 *
 * Pins dispatch a window event so an open notebook widget can refresh without a
 * shared global store.
 */

import { provenanceToMarkdown, type ExportProvenance } from '@/lib/exportWidget'

export const RESEARCH_NOTEBOOK_KEY = 'vnibb-research-notebook'
export const RESEARCH_NOTEBOOK_EVENT = 'vnibb:research-notebook:changed'

export type NotebookItemKind = 'news' | 'widget_snapshot' | 'agent_answer' | 'note'

export interface NotebookSource {
  id?: string
  label?: string
  url?: string
  sourceUrl?: string
  feedUrl?: string
  sourceName?: string
  sourceSystem?: string
  asOf?: string
  publishedAt?: string
}

export interface NotebookAgentMeta {
  provider?: string
  model?: string
}

export interface NotebookItem {
  id: string
  kind: NotebookItemKind
  title: string
  body?: string
  symbol?: string
  tags?: string[]
  sources?: NotebookSource[]
  agent?: NotebookAgentMeta
  dedupeKey?: string
  provenance?: Partial<ExportProvenance>
  createdAt: string
}

const MAX_ITEMS = 200
const NOTEBOOK_KINDS: NotebookItemKind[] = ['news', 'widget_snapshot', 'agent_answer', 'note']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeItem(value: unknown): NotebookItem | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  const kind = text(value.kind) as NotebookItemKind | undefined
  const title = text(value.title)
  const createdAt = text(value.createdAt)
  if (!id || !NOTEBOOK_KINDS.includes(kind as NotebookItemKind) || !title || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null
  const sources = Array.isArray(value.sources)
    ? value.sources.filter(isRecord).map((source) => ({
      id: text(source.id), label: text(source.label), url: text(source.url), sourceUrl: text(source.sourceUrl),
      feedUrl: text(source.feedUrl), sourceName: text(source.sourceName), sourceSystem: text(source.sourceSystem),
      asOf: text(source.asOf), publishedAt: text(source.publishedAt),
    }))
    : undefined
  const agent = isRecord(value.agent) ? { provider: text(value.agent.provider), model: text(value.agent.model) } : undefined
  return {
    id,
    kind: kind as NotebookItemKind,
    title,
    body: text(value.body),
    symbol: text(value.symbol),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    sources,
    agent,
    dedupeKey: text(value.dedupeKey),
    provenance: isRecord(value.provenance) ? value.provenance : undefined,
    createdAt,
  }
}

function readRaw(): NotebookItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RESEARCH_NOTEBOOK_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeItem).filter((item): item is NotebookItem => item !== null) : []
  } catch {
    return []
  }
}

function write(items: NotebookItem[]) {
  if (typeof window === 'undefined') return
  const next = items.slice(0, MAX_ITEMS)
  try {
    window.localStorage.setItem(RESEARCH_NOTEBOOK_KEY, JSON.stringify(next))
  } catch {
    try {
      window.localStorage.setItem(RESEARCH_NOTEBOOK_KEY, JSON.stringify(next.slice(0, Math.floor(MAX_ITEMS / 2))))
    } catch {
      // best-effort
    }
  }
  window.dispatchEvent(new CustomEvent(RESEARCH_NOTEBOOK_EVENT))
}

export function readNotebookItems(): NotebookItem[] {
  return readRaw().sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

export function addNotebookItem(input: Omit<NotebookItem, 'id' | 'createdAt'>): NotebookItem[] {
  const existing = input.dedupeKey
    ? readNotebookItems().find((item) => item.dedupeKey === input.dedupeKey)
    : undefined
  if (existing) return readNotebookItems()

  const item: NotebookItem = {
    ...input,
    id: `nb:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
  const next = [item, ...readNotebookItems()].slice(0, MAX_ITEMS)
  write(next)
  return next
}

export function removeNotebookItem(id: string): NotebookItem[] {
  const next = readNotebookItems().filter((item) => item.id !== id)
  write(next)
  return next
}

export function clearNotebook(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(RESEARCH_NOTEBOOK_KEY)
  window.dispatchEvent(new CustomEvent(RESEARCH_NOTEBOOK_EVENT))
}

const KIND_LABEL: Record<NotebookItemKind, string> = {
  news: 'News',
  widget_snapshot: 'Widget snapshot',
  agent_answer: 'VniAgent answer',
  note: 'Note',
}

/**
 * Render the whole notebook as source-preserving markdown. Each item keeps its
 * original source links; widget snapshots keep their provenance footer.
 */
export function notebookToMarkdown(items: NotebookItem[], title = 'VNIBB Research Notebook'): string {
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`_Exported ${new Date().toISOString()} · ${items.length} item${items.length === 1 ? '' : 's'} · browser-local notebook_`)
  lines.push('')

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title}`)
    lines.push('')
    const meta = [KIND_LABEL[item.kind], item.symbol, item.createdAt].filter(Boolean).join(' · ')
    if (meta) {
      lines.push(`_${meta}_`)
      lines.push('')
    }
    if (item.body) {
      lines.push(item.body)
      lines.push('')
    }
    if (item.tags?.length) {
      lines.push(`Tags: ${item.tags.join(', ')}`)
      lines.push('')
    }
    if (item.agent?.provider || item.agent?.model) {
      lines.push(`Model: ${[item.agent.provider, item.agent.model].filter(Boolean).join(' / ')}`)
      lines.push('')
    }
    if (item.sources?.length) {
      lines.push('Sources:')
      item.sources.forEach((source) => {
        const label = source.label || source.sourceName || source.id || 'Source'
        const links = [
          source.url ? `article: ${source.url}` : null,
          source.sourceUrl ? `source: ${source.sourceUrl}` : null,
          source.feedUrl ? `feed: ${source.feedUrl}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const details = [
          source.id ? `id ${source.id}` : null,
          source.sourceSystem ? `system ${source.sourceSystem}` : null,
          source.asOf ? `as of ${source.asOf}` : null,
          source.publishedAt ? `published ${source.publishedAt}` : null,
        ].filter(Boolean).join(', ')
        lines.push(`- ${label}${details ? ` (${details})` : ''}${links ? ` — ${links}` : ''}`)
      })
      lines.push('')
    }
    if (item.provenance) {
      const prov = provenanceToMarkdown(item.provenance as ExportProvenance)
      if (prov) {
        lines.push(prov)
        lines.push('')
      }
    }
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
}
