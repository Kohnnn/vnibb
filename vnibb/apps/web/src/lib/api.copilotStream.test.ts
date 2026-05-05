import { TextDecoder, TextEncoder } from 'util'

const mockAppwriteCreateJWT = jest.fn(async () => null)

jest.mock('@/lib/appwrite', () => ({
  appwriteClearSessionHint: jest.fn(),
  appwriteCreateJWT: () => mockAppwriteCreateJWT(),
  authProvider: 'appwrite',
  isAppwriteConfigured: false,
  isAppwriteUnauthorizedError: jest.fn(() => false),
}))

jest.mock('@/lib/env', () => ({
  env: {
    apiUrl: 'http://localhost:8000',
  },
}))

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}))

import { consumeCopilotStream, openCopilotChatStream } from '@/lib/api'

Object.assign(globalThis, { TextDecoder, TextEncoder })

describe('consumeCopilotStream', () => {
  test('parses validated source metadata from the done event', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      encoder.encode(
        `data: ${JSON.stringify({
          reasoning: {
            eventType: 'INFO',
            message: 'Building runtime context',
          },
        })}\n\n`,
      ),
      encoder.encode(`data: ${JSON.stringify({ chunk: 'Hello world' })}\n\n`),
      encoder.encode(
        `data: ${JSON.stringify({
          done: true,
          usedSourceIds: ['VNM-PRICES'],
          sources: [
            {
              id: 'VNM-PRICES',
              label: 'Price history snapshot',
              source: 'appwrite',
              as_of: '2026-04-03',
            },
          ],
          artifacts: [
            {
              id: 'comparison_snapshot',
              type: 'table',
              title: 'Comparison Snapshot',
              description: 'Validated comparison data',
              columns: [
                { key: 'symbol', label: 'Symbol', kind: 'text' },
                { key: 'price', label: 'Price', kind: 'currency' },
              ],
              rows: [
                { symbol: 'VNM', price: 72.4 },
                { symbol: 'FPT', price: 128.9 },
              ],
              sourceIds: ['VNM-PRICES'],
            },
            {
              id: 'price_trend_chart',
              type: 'chart',
              title: 'Normalized Price Trend',
              description: 'Base-100 trend',
              chartType: 'line',
              xKey: 'date',
              valueKind: 'number',
              series: [
                { key: 'VNM', label: 'VNM Base 100', color: '#22d3ee' },
              ],
              rows: [
                { date: '2026-04-01', VNM: 100 },
                { date: '2026-04-02', VNM: 101.5 },
              ],
              sourceIds: ['VNM-PRICES'],
            },
          ],
          actions: [
            {
              id: 'add_widget_price_chart',
              type: 'add_widget',
              label: 'Add Price Chart',
              description: 'Insert a price chart widget.',
              confirmText: 'Add a Price Chart widget to the current tab?',
              payload: { widgetType: 'price_chart' },
              sourceIds: ['VNM-PRICES'],
            },
          ],
          responseMeta: {
            responseId: 'resp-123',
            provider: 'openrouter',
            model: 'openai/gpt-4o-mini',
            mode: 'app_default',
            latencyMs: 812,
          },
        })}\n\n`,
      ),
    ]
    let readIndex = 0
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      body: {
        getReader: () => ({
          read: async () => {
            if (readIndex >= chunks.length) {
              return { done: true, value: undefined }
            }
            const value = chunks[readIndex]
            readIndex += 1
            return { done: false, value }
          },
        }),
      },
    } as unknown as Response

    const receivedChunks: string[] = []
    const onDone = jest.fn()
    const onReasoning = jest.fn()

    await consumeCopilotStream(response, {
      onChunk: (chunk) => receivedChunks.push(chunk),
      onReasoning,
      onDone,
    })

    expect(receivedChunks).toEqual(['Hello world'])
    expect(onReasoning).toHaveBeenCalledWith({
      eventType: 'INFO',
      message: 'Building runtime context',
      details: undefined,
    })
    expect(onDone).toHaveBeenCalledWith({
      done: true,
      chunk: undefined,
      error: undefined,
      reasoning: undefined,
      artifacts: [
        {
          id: 'comparison_snapshot',
          type: 'table',
          title: 'Comparison Snapshot',
          description: 'Validated comparison data',
          columns: [
            { key: 'symbol', label: 'Symbol', kind: 'text' },
            { key: 'price', label: 'Price', kind: 'currency' },
          ],
          rows: [
            { symbol: 'VNM', price: 72.4 },
            { symbol: 'FPT', price: 128.9 },
          ],
          sourceIds: ['VNM-PRICES'],
        },
        {
          id: 'price_trend_chart',
          type: 'chart',
          title: 'Normalized Price Trend',
          description: 'Base-100 trend',
          chartType: 'line',
          xKey: 'date',
          valueKind: 'number',
          series: [
            { key: 'VNM', label: 'VNM Base 100', color: '#22d3ee' },
          ],
          rows: [
            { date: '2026-04-01', VNM: 100 },
            { date: '2026-04-02', VNM: 101.5 },
          ],
          sourceIds: ['VNM-PRICES'],
        },
      ],
      actions: [
        {
          id: 'add_widget_price_chart',
          type: 'add_widget',
          label: 'Add Price Chart',
          description: 'Insert a price chart widget.',
          confirmText: 'Add a Price Chart widget to the current tab?',
          payload: { widgetType: 'price_chart' },
          sourceIds: ['VNM-PRICES'],
        },
      ],
      responseMeta: {
        responseId: 'resp-123',
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        mode: 'app_default',
        latencyMs: 812,
      },
      usedSourceIds: ['VNM-PRICES'],
      sources: [
        {
          id: 'VNM-PRICES',
          label: 'Price history snapshot',
          source: 'appwrite',
          asOf: '2026-04-03',
          kind: undefined,
          priority: undefined,
          scope: undefined,
          symbol: undefined,
        },
      ],
    })
  })
})

describe('openCopilotChatStream', () => {
  test('skips browser Appwrite JWT minting for copilot requests', async () => {
    const originalFetch = globalThis.fetch
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    } as unknown as Response)
    Object.assign(globalThis, { fetch: fetchSpy })

    await openCopilotChatStream({
      message: 'Analyze VCI',
      history: [],
      settings: {
        mode: 'app_default',
        provider: 'openrouter',
        model: '',
        apiKey: '',
        baseUrl: '',
        webSearch: false,
        preferAppwriteData: true,
        enableSidebarWorkflowOutputs: false,
      },
    })

    expect(mockAppwriteCreateJWT).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/copilot/chat/stream',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      }),
    )
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(requestInit.headers).has('Authorization')).toBe(false)

    Object.assign(globalThis, { fetch: originalFetch })
  })
})
