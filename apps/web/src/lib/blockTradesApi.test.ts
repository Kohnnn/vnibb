import { getBlockTrades } from './api'

const originalFetch = global.fetch

const respondWith = (body: unknown, status: number) => {
  const payload = { ok: status < 400, status, statusText: status === 200 ? 'OK' : 'Service Unavailable', json: async () => body }
  global.fetch = jest.fn(() => Promise.resolve(payload)) as unknown as typeof fetch
}

afterEach(() => {
  global.fetch = originalFetch
})

describe('getBlockTrades provider outcomes', () => {
  it('returns received prints for a legitimate empty tape', async () => {
    respondWith([], 200)

    await expect(getBlockTrades({ limit: 100 })).resolves.toEqual([])
  })

  it('surfaces the unavailable provider error instead of an empty tape', async () => {
    respondWith({ detail: 'Block-trade data unavailable' }, 503)

    await expect(getBlockTrades({ limit: 100 })).rejects.toThrow('Server error (503). Block-trade data unavailable')
  })
})
