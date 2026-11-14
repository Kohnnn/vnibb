import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { MaximizedWidgetPortal } from './MaximizedWidgetPortal';
import { TickerCombobox } from './TickerCombobox';

// #236 acceptance: a nested overlay opened from a maximized widget must portal
// out of the dialog, keep its own Escape, and hand focus back to its trigger
// without closing the maximized widget underneath.
function NestedOverlayHarness() {
  const [maximized, setMaximized] = useState(false);
  const [combobox, setCombobox] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return <>
    <button onClick={() => setMaximized(true)}>Maximize widget</button>
    <MaximizedWidgetPortal isOpen={maximized} title="Company" onClose={() => setMaximized(false)}>
      <button ref={anchorRef} type="button" onClick={() => setCombobox(open => !open)}>Select ticker</button>
      <TickerCombobox anchorRef={anchorRef} isOpen={combobox} onClose={() => setCombobox(false)} onSelect={() => setCombobox(false)} />
    </MaximizedWidgetPortal>
  </>;
}

it('keeps a nested picker out of the maximized dialog and unwinds one Escape at a time', async () => {
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288);
  jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 36, top: 100, left: 40, bottom: 136, right: 140, x: 40, y: 100, toJSON() {} } as DOMRect);
  const user = userEvent.setup();
  try {
    render(<NestedOverlayHarness />);
    const maximizeOpener = screen.getByRole('button', { name: 'Maximize widget' });
    await user.click(maximizeOpener);
    const outer = screen.getByRole('dialog', { name: 'Company' });
    await waitFor(() => expect(outer.contains(document.activeElement)).toBe(true));

    const trigger = screen.getByRole('button', { name: 'Select ticker' });
    await user.click(trigger);
    const picker = await screen.findByRole('dialog', { name: 'Select ticker' });
    // Portalled to body, not nested inside the modal subtree.
    expect(picker.parentElement).toBe(document.body);
    expect(outer).not.toContainElement(picker);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search ticker' })).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Select ticker' })).not.toBeInTheDocument();
    // The maximized widget survives and focus is back on the picker trigger.
    expect(screen.getByRole('dialog', { name: 'Company' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Company' })).not.toBeInTheDocument();
    await waitFor(() => expect(maximizeOpener).toHaveFocus());
  } finally {
    jest.restoreAllMocks();
  }
});
