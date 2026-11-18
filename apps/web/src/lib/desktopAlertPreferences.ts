import { logClientWarn } from '@/lib/clientLogger';

const STORAGE_KEY = 'vnibb-desktop-alert-opt-in';
const CHANGE_EVENT = 'vnibb-desktop-alert-change';
let requestingPermission = false;

// The server settings flag and browser permission alone are not consent to this app's alerts.
export function readDesktopAlertOptIn(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const enabledAt = Number(raw);
    return Number.isSafeInteger(enabledAt) && enabledAt > 0 ? enabledAt : null;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return null;
  }
}

export function subscribeDesktopAlertPreferences(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

export function readDesktopAlertPermission(): NotificationPermission | 'unsupported' {
  return typeof window === 'undefined' || typeof window.Notification !== 'function'
    ? 'unsupported'
    : window.Notification.permission;
}

export function isDesktopAlertPermissionPending(): boolean {
  return requestingPermission;
}

export async function enableDesktopAlerts(): Promise<boolean> {
  const permission = readDesktopAlertPermission();
  if (requestingPermission || permission === 'denied' || permission === 'unsupported') return false;

  requestingPermission = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  try {
    const result = permission === 'default' ? await window.Notification.requestPermission() : permission;
    if (result !== 'granted') return false;
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    return true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    logClientWarn('Desktop alert opt-in unavailable', { name: error.name });
    return false;
  } finally {
    requestingPermission = false;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function disableDesktopAlerts(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    logClientWarn('Desktop alert preference could not be saved', { name: error.name });
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}
