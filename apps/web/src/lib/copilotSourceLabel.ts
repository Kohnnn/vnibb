/**
 * Human label for a copilot evidence source.
 *
 * Legacy streamed and browser-persisted payloads still carry the pre-rename
 * `'appwrite'` sourceSystem, and older records omit the field entirely. Both
 * describe the VniBB market database, so they render as "VniBB database".
 *
 * This is the single compat point for that literal. Consumers must call this
 * helper instead of comparing the source string directly.
 */
export function getCopilotSourceLabel(source: string | undefined | null): string {
  return !source || source === 'appwrite' ? 'VniBB database' : source
}
