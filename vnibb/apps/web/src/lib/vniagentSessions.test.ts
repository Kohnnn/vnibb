import {
  archiveVniAgentSession,
  clearRecentVniAgentSessions,
  readRecentVniAgentSessions,
  removeRecentVniAgentSession,
  VNIAGENT_RECENT_SESSIONS_KEY,
} from '@/lib/vniagentSessions'

describe('vniagentSessions', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('archives only sessions with user messages', () => {
    archiveVniAgentSession({
      sessionKey: 'vnm:overview',
      symbol: 'VNM',
      messages: [
        { id: '1', role: 'assistant', content: 'Welcome', timestamp: '2026-04-17T10:00:00.000Z' },
      ],
    })

    expect(readRecentVniAgentSessions()).toEqual([])
  })

  test('stores recent sessions with title and preview', () => {
    const sessions = archiveVniAgentSession({
      sessionKey: 'vnm:overview',
      symbol: 'VNM',
      widgetContext: 'Price Chart',
      activeTabName: 'Overview',
      messages: [
        { id: '1', role: 'assistant', content: 'Welcome', timestamp: '2026-04-17T10:00:00.000Z' },
        { id: '2', role: 'user', content: 'Analyze VNM cash flow quality', timestamp: '2026-04-17T10:01:00.000Z' },
        { id: '3', role: 'assistant', content: 'Cash flow quality is improving.', timestamp: '2026-04-17T10:02:00.000Z' },
      ],
    })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual(expect.objectContaining({
      symbol: 'VNM',
      title: 'Analyze VNM cash flow quality',
      preview: 'Cash flow quality is improving.',
      messageCount: 3,
    }))
    expect(window.localStorage.getItem(VNIAGENT_RECENT_SESSIONS_KEY)).toContain('Analyze VNM cash flow quality')
  })

  test('removes archived sessions', () => {
    const [session] = archiveVniAgentSession({
      sessionKey: 'vnm:overview',
      symbol: 'VNM',
      messages: [
        { id: '2', role: 'user', content: 'Analyze VNM', timestamp: '2026-04-17T10:01:00.000Z' },
      ],
    })

    const next = removeRecentVniAgentSession(session.id)
    expect(next).toEqual([])

    clearRecentVniAgentSessions()
    expect(readRecentVniAgentSessions()).toEqual([])
  })
})
