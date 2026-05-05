'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

import { getDashboardClientId } from '@/lib/api'
import { captureAnalyticsPageview, initAnalytics } from '@/lib/analytics'
import { env } from '@/lib/env'

export function AnalyticsBootstrap() {
  const pathname = usePathname()
  const lastPageviewRef = useRef<string | null>(null)

  useEffect(() => {
    if (!env.posthogHost || !env.posthogKey) {
      return
    }

    initAnalytics({ clientId: getDashboardClientId() })
  }, [])

  useEffect(() => {
    const search = typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '')
    const nextKey = `${pathname || ''}?${search}`
    if (!pathname || lastPageviewRef.current === nextKey) {
      return
    }

    lastPageviewRef.current = nextKey
    captureAnalyticsPageview({
      pathname,
      search: search ? `?${search}` : '',
    })
  }, [pathname])

  return null
}

export default AnalyticsBootstrap
