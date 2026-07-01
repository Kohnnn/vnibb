// Next.js 16 App Router — /api/health proxy
// Fetches backend /health/ (basic) and /health/detailed (detailed)
// Returns { status, healthy, degraded, stale, timeout } — no secret leak

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

const BACKEND_API_URL = env.apiUrl ? `${env.apiUrl}/api/v1` : ''

type PublicEndpointHealth = {
    readonly ok: boolean
    readonly status: number
}

function publicEndpointHealth(response: Response): PublicEndpointHealth {
    return {
        ok: response.ok,
        status: response.status,
    }
}

export async function GET() {
    const start = Date.now()

    if (!BACKEND_API_URL) {
        return NextResponse.json(
            {
                status: 'unreachable',
                healthy: false,
                degraded: true,
                stale: true,
                timeout: false,
                error: 'backend_missing_config',
                backend: { configured: false },
            },
            { status: 502 },
        )
    }

    try {
        const [basicRes, detailedRes] = await Promise.all([
            fetch(`${BACKEND_API_URL}/health/`, {
                signal: AbortSignal.timeout(5000),
                headers: { Accept: 'application/json' },
            }),
            fetch(`${BACKEND_API_URL}/health/detailed`, {
                signal: AbortSignal.timeout(5000),
                headers: { Accept: 'application/json' },
            }),
        ])

        const elapsed = Date.now() - start

        return NextResponse.json({
            status: 'ok',
            healthy: basicRes.ok && detailedRes.ok,
            degraded: !basicRes.ok || !detailedRes.ok,
            stale: elapsed > 3000,
            timeout: elapsed > 5000,
            backend: {
                health: publicEndpointHealth(basicRes),
                health_detailed: publicEndpointHealth(detailedRes),
            },
            elapsed_ms: elapsed,
        })
    } catch (error) {
        const elapsed = Date.now() - start
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError'

        return NextResponse.json(
            {
                status: 'unreachable',
                healthy: false,
                degraded: true,
                stale: true,
                timeout: timedOut || elapsed > 5000,
                error: timedOut ? 'backend_timeout' : 'backend_unreachable',
                backend: { configured: true },
            },
            { status: 502 },
        )
    }
}