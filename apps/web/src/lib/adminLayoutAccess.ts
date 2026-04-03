const ADMIN_LAYOUT_KEY_STORAGE = 'vnibb_admin_layout_key'
const ADMIN_LAYOUT_KEY_VALIDATED_STORAGE = 'vnibb_admin_layout_key_validated'
const ADMIN_LAYOUT_CONTROLS_VISIBLE_STORAGE = 'vnibb_admin_layout_controls_visible'
const ADMIN_LAYOUT_EVENT = 'vnibb:admin-layout-key-updated'

export function readAdminLayoutKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ADMIN_LAYOUT_KEY_STORAGE) || ''
}

export function readAdminLayoutKeyValidated(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ADMIN_LAYOUT_KEY_VALIDATED_STORAGE) === '1'
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

export function writeAdminLayoutKeyValidated(value: boolean): void {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(ADMIN_LAYOUT_KEY_VALIDATED_STORAGE, '1')
  } else {
    window.localStorage.removeItem(ADMIN_LAYOUT_KEY_VALIDATED_STORAGE)
  }
  window.dispatchEvent(new Event(ADMIN_LAYOUT_EVENT))
}

export function clearAdminLayoutKey(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ADMIN_LAYOUT_KEY_STORAGE)
  window.localStorage.removeItem(ADMIN_LAYOUT_KEY_VALIDATED_STORAGE)
  window.dispatchEvent(new Event(ADMIN_LAYOUT_EVENT))
}

export function readAdminLayoutControlsVisible(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ADMIN_LAYOUT_CONTROLS_VISIBLE_STORAGE) === '1'
}

export function writeAdminLayoutControlsVisible(value: boolean): void {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(ADMIN_LAYOUT_CONTROLS_VISIBLE_STORAGE, '1')
  } else {
    window.localStorage.removeItem(ADMIN_LAYOUT_CONTROLS_VISIBLE_STORAGE)
  }
  window.dispatchEvent(new Event(ADMIN_LAYOUT_EVENT))
}

export function subscribeAdminLayoutKey(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  window.addEventListener(ADMIN_LAYOUT_EVENT, callback)
  return () => window.removeEventListener(ADMIN_LAYOUT_EVENT, callback)
}
