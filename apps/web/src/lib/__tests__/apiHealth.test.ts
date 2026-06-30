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

const INTERNAL_HEALTH_KEYS = [
    'basic',
    'detailed',
    'components',
    'db',
    'cache',
    'appwrite',
    'providers',
] as const

function expectNoBackendInternals(value: unknown): void {
    // Then: public health payload never exposes backend implementation details.
    for (const key of INTERNAL_HEALTH_KEYS) {
        expect(value).not.toHaveProperty(key)
        expect(value).not.toHaveProperty(['backend', key])
    }
}

describe('/api/health', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns sanitized healthy summary when both backend endpoints respond', async () => {
        // Given: backend health endpoints include private implementation details.
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ status: 'ok', db: 'connected', cache: { status: 'warm' } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    status: 'healthy',
                    components: { database: { status: 'healthy' } },
                    appwrite: { endpoint: 'private' },
                    providers: { vnstock: 'ready' },
                }),
            })

        // When: frontend proxy health is requested.
        const { GET } = await import('@/app/api/health/route')
        const response = await GET()
        const body = await response.json()

        // Then: only public health fields and endpoint summaries are returned.
        expect(response.status).toBe(200)
        expect(body).toMatchObject({
            status: 'ok',
            healthy: true,
            degraded: false,
            stale: false,
            timeout: false,
            backend: {
                health: { ok: true, status: 200 },
                health_detailed: { ok: true, status: 200 },
            },
        })
        expectNoBackendInternals(body)
    })

    it('returns degraded public summary when one backend endpoint responds non-ok', async () => {
        // Given: both backend fetches resolve, but detailed health is unavailable.
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ status: 'ok', db: 'connected' }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                json: async () => ({ components: { database: { status: 'down' } } }),
            })

        // When: frontend proxy health is requested.
        const { GET } = await import('@/app/api/health/route')
        const response = await GET()
        const body = await response.json()

        // Then: the proxy degrades without leaking backend internals or failing the route.
        expect(response.status).toBe(200)
        expect(body).toMatchObject({
            status: 'ok',
            healthy: false,
            degraded: true,
            backend: {
                health: { ok: true, status: 200 },
                health_detailed: { ok: false, status: 503 },
            },
        })
        expectNoBackendInternals(body)
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