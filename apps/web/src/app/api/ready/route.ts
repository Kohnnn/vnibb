// Next.js 16 App Router — /api/ready proxy
// Readiness probe: returns 200 only when the backend DB connection succeeds.
// The Next.js edge caches the response for 15s (matching backend s-maxage).

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

const BACKEND_API_URL = env.apiUrl ? `${env.apiUrl}/api/v1` : ''

export async function GET() {
    if (!BACKEND_API_URL) {
        return NextResponse.json(
            { status: 'not_ready', reason: 'backend_missing_config' },
            { status: 503 },
        )
    }

    try {
        const res = await fetch(`${BACKEND_API_URL}/health/ready`, {
            signal: AbortSignal.timeout(3000),
            cache: 'no-store',
        })
        const body = await res.json().catch(() => null)
        return NextResponse.json(body ?? { status: 'unknown' }, { status: res.status })
    } catch (error) {
        return NextResponse.json(
            {
                status: 'not_ready',
                reason:
                    error instanceof DOMException && error.name === 'TimeoutError'
                        ? 'timeout'
                        : 'unreachable',
            },
            { status: 503 },
        )
    }
}
