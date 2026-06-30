// Frontend /api/health route test — validates proxy returns correct shape
// without leaking backend internals

// Mock the route module's imports before importing
jest.mock('@/lib/env', () => ({
    env: { apiUrl: 'http://localhost:8000' },
}))

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

// Mock NextResponse to avoid Next.js runtime dependency in test
jest.mock('next/server', () => ({
    NextResponse: {
        json: (body: unknown, init?: { status?: number }) => {
            const status = init?.status ?? 200
            return {
                status,
                json: async () => body,
            }
        },
    },
}))

describe('/api/health', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns healthy when both backend endpoints respond', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', db: 'connected' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'healthy', components: { database: { status: 'healthy' } } }),
            })

        const { GET } = await import('@/app/api/health/route')
        const response = await GET()
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body).toMatchObject({
            status: 'ok',
            healthy: true,
            degraded: false,
            stale: false,
            timeout: false,
        })
        expect(body.backend).toBeDefined()
        expect(body.backend.basic).toBeDefined()
        expect(body.backend.detailed).toBeDefined()
    })

    it('returns degraded when backend is unreachable', async () => {
        mockFetch
            .mockRejectedValueOnce(new Error('fetch failed'))
            .mockRejectedValueOnce(new Error('fetch failed'))

        const { GET } = await import('@/app/api/health/route')
        const response = await GET()
        const body = await response.json()

        expect(response.status).toBe(502)
        expect(body).toMatchObject({
            status: 'unreachable',
            healthy: false,
            degraded: true,
            stale: true,
        })
    })

    it('returns timeout status when backend request times out', async () => {
        mockFetch.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))

        const { GET } = await import('@/app/api/health/route')
        const response = await GET()
        const body = await response.json()

        expect(response.status).toBe(502)
        expect(body).toMatchObject({
            status: 'unreachable',
            healthy: false,
            degraded: true,
            stale: true,
            timeout: true,
            error: 'backend_timeout',
        })
    })

    it('returns degraded when one endpoint fails', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', db: 'connected' }),
            })
            .mockRejectedValueOnce(new Error('timeout'))

        const { GET } = await import('@/app/api/health/route')
        const body = await (await GET()).json()

        expect(body.healthy).toBe(false)
        expect(body.degraded).toBe(true)
    })
})