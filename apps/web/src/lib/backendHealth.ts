import { env } from '@/lib/env'

const LOCALHOST_OR_LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeApiBase(value: string): string {
  const normalized = stripTrailingSlash(value)
  if (!normalized) return normalized
  return normalized.replace(/\/api\/v1$/i, '')
}

export function getRuntimeApiBaseUrl(input?: string): string {
  const raw = normalizeApiBase((input || env.apiUrl || '').trim())
  if (!raw) return raw

  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    raw.startsWith('http://') &&
    !LOCALHOST_OR_LOOPBACK_RE.test(raw)
  ) {
    return raw.replace(/^http:/, 'https:')
  }

  return raw
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface BackendProbeResult {
  liveOk: boolean
  readyOk: boolean
}

export async function probeBackendReadiness(timeoutMs = 8000): Promise<BackendProbeResult> {
  const baseApiUrl = getRuntimeApiBaseUrl()
  if (!baseApiUrl) {
    return { liveOk: false, readyOk: false }
  }

  try {
    const [liveRes, readyRes] = await Promise.allSettled([
      fetchWithTimeout(`${baseApiUrl}/live`, timeoutMs),
      fetchWithTimeout(`${baseApiUrl}/ready`, timeoutMs),
    ])

    const liveOk = liveRes.status === 'fulfilled' && liveRes.value.ok
    const readyOk = readyRes.status === 'fulfilled' && readyRes.value.ok
    return { liveOk, readyOk }
  } catch {
    return { liveOk: false, readyOk: false }
  }
}
