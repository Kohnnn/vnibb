const ADMIN_LAYOUT_KEY_STORAGE = 'vnibb_admin_layout_key'
const ADMIN_LAYOUT_EVENT = 'vnibb:admin-layout-key-updated'

export function readAdminLayoutKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ADMIN_LAYOUT_KEY_STORAGE) || ''
}

export function writeAdminLayoutKey(value: string): void {
  if (typeof window === 'undefined') return
  const normalized = value.trim()
  if (normalized) {
    window.localStorage.setItem(ADMIN_LAYOUT_KEY_STORAGE, normalized)
  } else {
    window.localStorage.removeItem(ADMIN_LAYOUT_KEY_STORAGE)
  }
  window.dispatchEvent(new Event(ADMIN_LAYOUT_EVENT))
}

export function clearAdminLayoutKey(): void {
  writeAdminLayoutKey('')
}

export function subscribeAdminLayoutKey(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  window.addEventListener(ADMIN_LAYOUT_EVENT, callback)
  return () => window.removeEventListener(ADMIN_LAYOUT_EVENT, callback)
}
