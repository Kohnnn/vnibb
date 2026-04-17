'use client';

import { useEffect, useState } from 'react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { CommandPalette } from './CommandPalette';

export function CommandPaletteWrapper() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (target.isContentEditable) return true;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (event.defaultPrevented || event.isComposing || event.repeat) return;
        if (!open && isEditableTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!open) {
          captureAnalyticsEvent(ANALYTICS_EVENTS.commandPaletteOpened, { source: 'shortcut' });
        }
        setOpen((current) => !current);
      }
    };

    const handleOpen = (event: Event) => {
      const source = event instanceof CustomEvent && typeof event.detail?.source === 'string'
        ? event.detail.source
        : 'external';
      captureAnalyticsEvent(ANALYTICS_EVENTS.commandPaletteOpened, { source });
      setOpen(true);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('vnibb:open-command-palette', handleOpen);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('vnibb:open-command-palette', handleOpen);
    };
  }, [open]);

  return (
    <CommandPalette open={open} onOpenChange={setOpen} />
  );
}
