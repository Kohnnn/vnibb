'use client';

import { useState } from 'react';
import { CommandPalette } from './CommandPalette';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function CommandPaletteWrapper() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts([
    { key: 'k', ctrl: true, action: () => setOpen(prev => !prev) },
  ]);

  return (
    <CommandPalette open={open} onOpenChange={setOpen} />
  );
}
