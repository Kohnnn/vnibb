'use client'

export const VNIAGENT_RECENT_SESSIONS_KEY = 'vnibb-vniagent-recent-sessions'

export interface VniAgentSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  reasoning?: string
  usedSourceIds?: string[]
  sources?: unknown[]
  artifacts?: unknown[]
  actions?: unknown[]
  responseMeta?: unknown
  feedbackVote?: 'up' | 'down'
}

export interface VniAgentSessionArchive {
  id: string
  sessionKey: string
  symbol: string
  widgetContext?: string | null
  activeTabName?: string | null
  title: string
  preview: string
  updatedAt: string
  messageCount: number
  messages: VniAgentSessionMessage[]
}

const MAX_RECENT_SESSIONS = 8

function readRawArchives(): VniAgentSessionArchive[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(VNIAGENT_RECENT_SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as VniAgentSessionArchive[] : []
  } catch {
    return []
  }
}

function writeArchives(next: VniAgentSessionArchive[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(VNIAGENT_RECENT_SESSIONS_KEY, JSON.stringify(next.slice(0, MAX_RECENT_SESSIONS)))
}

function trimMessageContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function buildSessionTitle(messages: VniAgentSessionMessage[], symbol: string): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && trimMessageContent(message.content))
  if (!firstUserMessage) return `Research ${symbol}`

  const trimmed = trimMessageContent(firstUserMessage.content)
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed
}

function buildSessionPreview(messages: VniAgentSessionMessage[]): string {
  const lastMeaningful = [...messages].reverse().find((message) => trimMessageContent(message.content))
  if (!lastMeaningful) return 'No preview available'

  const trimmed = trimMessageContent(lastMeaningful.content)
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed
}

export function readRecentVniAgentSessions(): VniAgentSessionArchive[] {
  return readRawArchives()
    .filter((archive) => Array.isArray(archive.messages) && archive.messages.length > 0)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export function archiveVniAgentSession(input: {
  sessionKey: string
  symbol: string
  widgetContext?: string | null
  activeTabName?: string | null
  messages: VniAgentSessionMessage[]
}): VniAgentSessionArchive[] {
  const meaningfulMessages = input.messages.filter((message) => trimMessageContent(message.content))
  const hasUserInput = meaningfulMessages.some((message) => message.role === 'user')
  if (!hasUserInput) {
    return readRecentVniAgentSessions()
  }

  const nextArchive: VniAgentSessionArchive = {
    id: `${input.sessionKey}:${new Date().toISOString()}`,
    sessionKey: input.sessionKey,
    symbol: input.symbol,
    widgetContext: input.widgetContext || null,
    activeTabName: input.activeTabName || null,
    title: buildSessionTitle(meaningfulMessages, input.symbol),
    preview: buildSessionPreview(meaningfulMessages),
    updatedAt: meaningfulMessages[meaningfulMessages.length - 1]?.timestamp || new Date().toISOString(),
    messageCount: meaningfulMessages.length,
    messages: meaningfulMessages.slice(-40),
  }

  const remaining = readRecentVniAgentSessions().filter((archive) => archive.id !== nextArchive.id)
  const next = [nextArchive, ...remaining].slice(0, MAX_RECENT_SESSIONS)
  writeArchives(next)
  return next
}

export function removeRecentVniAgentSession(id: string): VniAgentSessionArchive[] {
  const next = readRecentVniAgentSessions().filter((archive) => archive.id !== id)
  writeArchives(next)
  return next
}

export function clearRecentVniAgentSessions(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(VNIAGENT_RECENT_SESSIONS_KEY)
}
