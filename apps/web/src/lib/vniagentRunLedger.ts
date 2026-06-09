'use client'

/**
 * Browser-local VniAgent run ledger.
 *
 * Phase 1 (Fincept/Quantcept-inspired) auditability: each completed VniAgent run
 * is recorded as a structured ledger entry (prompt, answer preview, sources /
 * evidence, tools used, response metadata, timing, status). This makes AI answers
 * auditable and exportable instead of only conversational, without any backend
 * schema change. A storage governor prunes old runs predictably so browser
 * storage cannot overflow.
 *
 * This is intentionally local-first; a backend run store can come later if
 * sharing/resume requirements justify it.
 */

export const VNIAGENT_RUN_LEDGER_KEY = 'vnibb-vniagent-run-ledger'

export type VniAgentRunStatus = 'completed' | 'error' | 'timeout'

export interface VniAgentRunSource {
  id?: string
  label?: string
  kind?: string
  source?: string
  symbol?: string
  asOf?: string
  url?: string
}

export interface VniAgentRunEntry {
  id: string
  createdAt: string
  symbol: string
  widgetContext?: string | null
  activeTabName?: string | null
  prompt: string
  answerPreview: string
  status: VniAgentRunStatus
  provider?: string | null
  model?: string | null
  latencyMs?: number | null
  /** Evidence/source refs captured from the stream `done` event. */
  sources: VniAgentRunSource[]
  /** Tool names the run used (e.g. MCP-backed reads), when surfaced. */
  toolsUsed: string[]
  sourceCount: number
  artifactCount: number
  actionCount: number
}

const MAX_RUNS = 50

function readRaw(): VniAgentRunEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(VNIAGENT_RUN_LEDGER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as VniAgentRunEntry[]) : []
  } catch {
    return []
  }
}

function writeRuns(next: VniAgentRunEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VNIAGENT_RUN_LEDGER_KEY, JSON.stringify(next.slice(0, MAX_RUNS)))
  } catch {
    // Storage governor: if quota is exceeded, drop to the newest half and retry once.
    try {
      window.localStorage.setItem(
        VNIAGENT_RUN_LEDGER_KEY,
        JSON.stringify(next.slice(0, Math.floor(MAX_RUNS / 2))),
      )
    } catch {
      // Give up silently; the ledger is a best-effort local aid.
    }
  }
}

function trim(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function readVniAgentRuns(): VniAgentRunEntry[] {
  return readRaw().sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

export function recordVniAgentRun(input: {
  symbol: string
  widgetContext?: string | null
  activeTabName?: string | null
  prompt: string
  answer: string
  status: VniAgentRunStatus
  provider?: string | null
  model?: string | null
  latencyMs?: number | null
  sources?: VniAgentRunSource[]
  toolsUsed?: string[]
  sourceCount?: number
  artifactCount?: number
  actionCount?: number
}): VniAgentRunEntry[] {
  const prompt = trim(input.prompt, 240)
  if (!prompt) return readVniAgentRuns()

  const sources = (input.sources || []).slice(0, 24)
  const entry: VniAgentRunEntry = {
    id: `run:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    symbol: input.symbol || 'UNKNOWN',
    widgetContext: input.widgetContext ?? null,
    activeTabName: input.activeTabName ?? null,
    prompt,
    answerPreview: trim(input.answer, 280),
    status: input.status,
    provider: input.provider ?? null,
    model: input.model ?? null,
    latencyMs: input.latencyMs ?? null,
    sources,
    toolsUsed: (input.toolsUsed || []).slice(0, 24),
    sourceCount: input.sourceCount ?? sources.length,
    artifactCount: input.artifactCount ?? 0,
    actionCount: input.actionCount ?? 0,
  }

  const next = [entry, ...readVniAgentRuns()].slice(0, MAX_RUNS)
  writeRuns(next)
  return next
}

export function removeVniAgentRun(id: string): VniAgentRunEntry[] {
  const next = readVniAgentRuns().filter((run) => run.id !== id)
  writeRuns(next)
  return next
}

export function clearVniAgentRuns(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(VNIAGENT_RUN_LEDGER_KEY)
}

/**
 * Render a single run as a self-describing markdown ledger (prompt, answer,
 * evidence/sources with URLs, tools used, run metadata). Reused by the export
 * action so the exported artifact contains the same ledger the user sees.
 */
export function runToMarkdown(run: VniAgentRunEntry): string {
  const lines: string[] = []
  lines.push(`# VniAgent run — ${run.symbol}`)
  lines.push('')
  lines.push(`- Run: ${run.id}`)
  lines.push(`- When: ${run.createdAt}`)
  lines.push(`- Status: ${run.status}`)
  if (run.widgetContext) lines.push(`- Context: ${run.widgetContext}`)
  if (run.activeTabName) lines.push(`- Tab: ${run.activeTabName}`)
  if (run.provider || run.model) lines.push(`- Model: ${[run.provider, run.model].filter(Boolean).join(' / ')}`)
  if (run.latencyMs != null) lines.push(`- Latency: ${run.latencyMs} ms`)
  lines.push('')
  lines.push('## Prompt')
  lines.push('')
  lines.push(run.prompt)
  lines.push('')
  lines.push('## Answer')
  lines.push('')
  lines.push(run.answerPreview || '(no answer captured)')
  lines.push('')
  if (run.toolsUsed.length) {
    lines.push('## Tools used')
    lines.push('')
    run.toolsUsed.forEach((tool) => lines.push(`- ${tool}`))
    lines.push('')
  }
  lines.push('## Sources & evidence')
  lines.push('')
  if (run.sources.length) {
    run.sources.forEach((source) => {
      const label = source.label || source.kind || source.id || 'Source'
      const meta = [
        source.source === 'appwrite' ? 'VNIBB database' : source.source,
        source.symbol,
        source.asOf ? `as of ${source.asOf}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      const link = source.url ? ` — ${source.url}` : ''
      lines.push(`- ${label}${meta ? ` (${meta})` : ''}${link}`)
    })
  } else {
    lines.push('_No source evidence was attached to this run._')
  }
  lines.push('')
  return lines.join('\n')
}
