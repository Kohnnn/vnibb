'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * App-wide toast host. Standardizes transient feedback on `sonner` instead of
 * the bespoke timed banners that previously lived in DashboardClient.
 * Use `import { toast } from 'sonner'` anywhere to fire notifications.
 *
 * Theme-aware: follows the resolved app theme so toasts match dark/light.
 */
export function AppToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="bottom-center"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
        },
      }}
    />
  );
}
