'use client';

import { useEffect, useState } from 'react';
import { CommandPalette } from './CommandPalette';

export function CommandPaletteWrapper() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }
    };

    const handleOpen = () => setOpen(true);

    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('vnibb:open-command-palette', handleOpen);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('vnibb:open-command-palette', handleOpen);
    };
  }, []);

  return (
    <CommandPalette open={open} onOpenChange={setOpen} />
  );
}
