// API Configuration and Utilities

import { env } from '@/lib/env';

const LOCALHOST_OR_LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
const SSLIP_HOST_RE = /^[0-9]+(?:[.-][0-9]+){3}\.sslip\.io$/i

function getRuntimeApiBaseUrl(rawValue: string): string {
    const trimmed = rawValue.replace(/\/$/, '')
    if (!trimmed) return trimmed

    if (typeof window === 'undefined') {
        return trimmed
    }

    const pageIsHttps = window.location.protocol === 'https:'
    const targetIsHttp = trimmed.startsWith('http://')
    const targetIsLocal = LOCALHOST_OR_LOOPBACK_RE.test(trimmed)
    const targetUrl = (() => {
        try {
            return new URL(trimmed)
        } catch {
            return null
        }
    })()
    const targetIsSslipIp = targetUrl ? SSLIP_HOST_RE.test(targetUrl.hostname) : false

    if (!pageIsHttps || !targetIsHttp) {
        return trimmed
    }

    return targetIsLocal || targetIsSslipIp ? trimmed : trimmed.replace(/^http:/, 'https:')
}

export const API_BASE_URL = `${getRuntimeApiBaseUrl(env.apiUrl)}/api/v1`;
const DASHBOARD_CLIENT_ID_STORAGE_KEY = 'vnibb_dashboard_client_id'


function createDashboardClientId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '')
    }

    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`
}


export function getDashboardClientId(): string | null {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return null
    }

    const existing = window.localStorage.getItem(DASHBOARD_CLIENT_ID_STORAGE_KEY)
    if (existing) {
        return existing
    }

    const next = createDashboardClientId()
    window.localStorage.setItem(DASHBOARD_CLIENT_ID_STORAGE_KEY, next)
    return next
}


function withDashboardClientHeader(headers?: HeadersInit): HeadersInit {
    const resolved = new Headers(headers || {})
    const clientId = getDashboardClientId()
    if (clientId && !resolved.has('X-VNIBB-Client-ID')) {
        resolved.set('X-VNIBB-Client-ID', clientId)
    }
    return resolved
}
