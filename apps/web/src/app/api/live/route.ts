// Next.js 16 App Router — /api/live proxy
// Cheap liveness probe: returns 200 as long as the Python process can be
// reached at all. Used by orchestrators and the workspace boot probe.

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

const BACKEND_API_URL = env.apiUrl ? `${env.apiUrl}/api/v1` : ''

export async function GET() {
    if (!BACKEND_API_URL) {
        return NextResponse.json(
            { status: 'alive', backend_configured: false },
            { status: 200 },
        )
    }

    try {
        const res = await fetch(`${BACKEND_API_URL}/health/live`, {
            signal: AbortSignal.timeout(2000),
            cache: 'no-store',
        })
        const body = await res.json().catch(() => null)
        return NextResponse.json(
            {
                status: res.ok ? 'alive' : 'unreachable',
                backend_status: res.status,
                body,
            },
            { status: res.status === 0 ? 200 : res.status },
        )
    } catch (error) {
        return NextResponse.json(
            {
                status: 'unreachable',
                error: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'unreachable',
            },
            { status: 200 }, // /live is allowed to return 200 even when the backend
                             // is unreachable, since liveness only signals the
                             // Next.js process is alive.
        )
    }
}
