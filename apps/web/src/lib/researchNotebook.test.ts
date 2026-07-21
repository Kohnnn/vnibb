import {
  RESEARCH_NOTEBOOK_KEY,
  addNotebookItem,
  clearNotebook,
  notebookToMarkdown,
  readNotebookItems,
} from './researchNotebook'

describe('research notebook', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    clearNotebook()
  })

  test('filters malformed stored notebook records at the load boundary', () => {
    window.localStorage.setItem(RESEARCH_NOTEBOOK_KEY, JSON.stringify([
      { id: 'nb:valid', kind: 'news', title: 'Valid', createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 'nb:bad-kind', kind: 'unknown', title: 'Bad', createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 'nb:bad-date', kind: 'news', title: 'Bad', createdAt: 'not-a-date' },
      { kind: 'news', title: 'Missing ID', createdAt: '2026-07-20T00:00:00.000Z' },
    ]))

    expect(readNotebookItems()).toEqual([expect.objectContaining({ id: 'nb:valid', title: 'Valid' })])
  })

  test('deduplicates saved agent answers and preserves source references in markdown', () => {
    const input = {
      kind: 'agent_answer' as const,
      title: 'VniAgent answer — VNM',
      body: 'Full rendered answer',
      symbol: 'VNM',
      agent: { provider: 'openrouter', model: 'model-a' },
      sources: [{ id: 'source-1', label: 'VNIBB', sourceSystem: 'appwrite', url: 'https://example.test/source', asOf: '2026-07-16T00:00:00Z' }],
      dedupeKey: 'vniagent:answer-1',
      provenance: { endpoint: '/api/v1/copilot/chat/stream', localOnly: true },
    }

    addNotebookItem(input)
    addNotebookItem(input)

    const items = readNotebookItems()
    expect(items).toHaveLength(1)
    expect(window.localStorage.getItem(RESEARCH_NOTEBOOK_KEY)).toContain('Full rendered answer')
    expect(notebookToMarkdown(items)).toContain('id source-1, system appwrite, as of 2026-07-16T00:00:00Z')
    expect(notebookToMarkdown(items)).toContain('article: https://example.test/source')
  })
})
