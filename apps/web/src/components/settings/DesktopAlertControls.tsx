'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  disableDesktopAlerts,
  enableDesktopAlerts,
  isDesktopAlertPermissionPending,
  readDesktopAlertOptIn,
  readDesktopAlertPermission,
  subscribeDesktopAlertPreferences,
} from '@/lib/desktopAlertPreferences';

const actionClass = 'min-h-11 rounded border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-50';

export function useDesktopAlertStatus() {
  const enabledAt = useSyncExternalStore(subscribeDesktopAlertPreferences, readDesktopAlertOptIn, () => null);
  const permission = useSyncExternalStore(subscribeDesktopAlertPreferences, readDesktopAlertPermission, () => 'unsupported' as const);
  return { enabled: enabledAt !== null, permission };
}

export function DesktopAlertControls() {
  const { enabled, permission } = useDesktopAlertStatus();
  const pending = useSyncExternalStore(subscribeDesktopAlertPreferences, isDesktopAlertPermissionPending, () => false);
  const [preferenceError, setPreferenceError] = useState(false);

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-[var(--text-secondary)]">
        {permission === 'unsupported' ? 'This browser does not support desktop alerts.'
          : permission === 'denied' ? 'Desktop alerts are blocked in your browser settings.'
          : enabled && permission === 'granted' ? 'Desktop alerts are on in this browser.'
          : 'Desktop alerts are off. Activity still appears in the inbox.'}
      </p>
      {enabled ? (
        <button type="button" className={actionClass} onClick={() => setPreferenceError(!disableDesktopAlerts())}>
          Turn off desktop alerts
        </button>
      ) : (permission === 'default' || permission === 'granted') && (
        <button type="button" className={actionClass} disabled={pending} onClick={async () => {
          setPreferenceError(false);
          const saved = await enableDesktopAlerts();
          setPreferenceError(!saved && readDesktopAlertPermission() === 'granted');
        }}>
          Enable desktop alerts
        </button>
      )}
      {preferenceError && <p role="status" className="text-xs text-[var(--text-secondary)]">Could not save the desktop alert preference in this browser.</p>}
    </div>
  );
}
