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

function readDataBackend(basicBody: unknown): string | null {
    if (!basicBody || typeof basicBody !== 'object') return null
    const providers = (basicBody as { providers?: unknown }).providers
    if (!providers || typeof providers !== 'object') return null
    const value = (providers as { data_backend?: unknown }).data_backend
    return typeof value === 'string' ? value : null
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

        const basicBody = basicRes.ok ? await basicRes.json().catch(() => null) : null
        const detailedBody = detailedRes.ok
            ? await detailedRes.json().catch(() => null)
            : null

        // The backend reports `degraded` (stale snapshot, DB error) while still
        // answering 200, so an `ok` here used to imply health we had not
        // actually confirmed. Carry the backend's own verdict through, and count
        // a missing detailed body as unknown rather than healthy.
        const backendStatus =
            detailedBody && typeof detailedBody === 'object'
                ? (detailedBody as { status?: unknown }).status
                : undefined
        const backendDegraded = backendStatus === 'degraded' || backendStatus === 'unhealthy'
        const reachable = basicRes.ok && detailedRes.ok

        return NextResponse.json({
            status: !reachable ? 'unhealthy' : backendDegraded ? 'degraded' : 'ok',
            healthy: reachable && !backendDegraded,
            degraded: !reachable || backendDegraded,
            stale: elapsed > 3000,
            timeout: elapsed > 5000,
            data_backend: readDataBackend(basicBody),
            backend_status: typeof backendStatus === 'string' ? backendStatus : null,
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