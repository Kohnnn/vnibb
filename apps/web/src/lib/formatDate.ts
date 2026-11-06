/**
 * Date/time formatting helpers.
 *
 * Split out of `lib/format.ts` (#198): the old module also carried a second
 * percent formatter and Tailwind colour helpers that competed with
 * `lib/units.ts` and `lib/priceColor.ts`. Date formatting is the only part the
 * app still consumes.
 */

/** Parse a date-ish value, returning null when it is absent or unparseable. */
export function parseFlexibleDate(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const raw = String(value).trim()
  if (!raw) return null

  const lower = raw.toLowerCase()
  const now = new Date()
  if (['just now', 'vua xong', 'vừa xong', 'moi dang', 'mới đăng'].includes(lower)) {
    return now
  }

  const relativeMatch = lower.match(/^(\d+)\s*(phut|phút|min|minute|minutes|gio|giờ|hour|hours|ngay|ngày|day|days)\s*(truoc|trước|ago)$/)
  if (relativeMatch) {
    const amount = Number(relativeMatch[1])
    const unit = relativeMatch[2]
    const parsed = new Date(now)

    if (['phut', 'phút', 'min', 'minute', 'minutes'].includes(unit)) {
      parsed.setMinutes(parsed.getMinutes() - amount)
      return parsed
    }
    if (['gio', 'giờ', 'hour', 'hours'].includes(unit)) {
      parsed.setHours(parsed.getHours() - amount)
      return parsed
    }
    if (['ngay', 'ngày', 'day', 'days'].includes(unit)) {
      parsed.setDate(parsed.getDate() - amount)
      return parsed
    }
  }

  if (lower === 'yesterday' || lower === 'hom qua' || lower === 'hôm qua') {
    const parsed = new Date(now)
    parsed.setDate(parsed.getDate() - 1)
    return parsed
  }

  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) {
    const parsed = new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const dmy = raw.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i,
  )
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3])
    const meridiem = dmy[7]?.toLowerCase()
    let hour = Number(dmy[4] ?? 0)
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    const parsed = new Date(
      year,
      Number(dmy[2]) - 1,
      Number(dmy[1]),
      hour,
      Number(dmy[5] ?? 0),
      Number(dmy[6] ?? 0),
    )
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const fallback = new Date(raw.replace(/\//g, '-'))
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** `YYYY-MM-DD HH:mm` in the browser's local time. */
export function formatAbsoluteTimestamp(
  date: Date | string | number | null | undefined,
): string {
  const parsed = parseFlexibleDate(date)
  if (!parsed) return '-'

  const yyyy = parsed.getFullYear()
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  const hh = String(parsed.getHours()).padStart(2, '0')
  const min = String(parsed.getMinutes()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/** Alias kept for callers that ask for a generic timestamp. */
export function formatTimestamp(
  date: Date | string | number | null | undefined,
): string {
  if (date === null || date === undefined) return '-'
  return formatAbsoluteTimestamp(date)
}

/** Locale-agnostic `YYYY-MM-DD`. */
export function formatShortDate(
  date: Date | string | number | null | undefined,
): string {
  const parsed = parseFlexibleDate(date)
  if (!parsed) return '-'
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** Date-only helper; the format/locale arguments are accepted but unused. */
export function formatDate(
  date: Date | string,
  _format: 'short' | 'medium' | 'long' | 'full' = 'medium',
  _locale: string = 'en-US',
): string {
  return formatTimestamp(date)
}

/** Local clock time, optionally with seconds. */
export function formatTime(
  date: Date | string,
  includeSeconds: boolean = false,
  locale: string = 'en-US',
): string {
  const parsed = parseFlexibleDate(date)
  if (!parsed) return '-'

  return parsed.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
  })
}

/** Coarse relative age (`5m ago`), falling back to an absolute timestamp. */
export function formatRelativeTime(
  date: Date | string | number | null | undefined,
): string {
  const parsed = parseFlexibleDate(date)
  if (!parsed) return '-'

  const diffMinutes = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 60000))
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return formatAbsoluteTimestamp(parsed)
}
