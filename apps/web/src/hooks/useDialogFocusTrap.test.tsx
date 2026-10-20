import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDialogFocusTrap } from './useDialogFocusTrap';

function ChildDialog({ onClose }: { onClose: () => void }) {
    const dialogRef = useDialogFocusTrap<HTMLElement>({ enabled: true, onClose });
    return createPortal(
        <section ref={dialogRef} role="dialog" aria-label="Research transfer" tabIndex={-1}>
            <button type="button" onClick={onClose}>Close research transfer</button>
            <button type="button">Download research</button>
        </section>,
        document.body,
    );
}

function NavigationDialog({ onClose }: { onClose: () => void }) {
    const [childOpen, setChildOpen] = useState(false);
    const closeChild = useCallback(() => setChildOpen(false), []);
    const dialogRef = useDialogFocusTrap<HTMLElement>({ enabled: true, onClose });
    return <>
        <section ref={dialogRef} role="dialog" aria-label="Navigation" tabIndex={-1}>
            <button type="button" onClick={onClose}>Close navigation</button>
            <button type="button" onClick={() => setChildOpen(true)}>Transfer research</button>
        </section>
        {childOpen && <ChildDialog onClose={closeChild} />}
    </>;
}

function NavigationLauncher() {
    const [open, setOpen] = useState(false);
    return <>
        <button type="button" onClick={() => setOpen(true)}>Open navigation</button>
        {open && <NavigationDialog onClose={() => setOpen(false)} />}
    </>;
}

it('gives a portaled child dialog focus ownership and restores each opener after Escape', async () => {
    const visibleElements = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
    const user = userEvent.setup();
    try {
        const view = render(<NavigationLauncher />);
        const navigationOpener = screen.getByRole('button', { name: 'Open navigation' });
        await user.click(navigationOpener);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus());
        const researchOpener = screen.getByRole('button', { name: 'Transfer research' });
        await user.click(researchOpener);
        const childClose = screen.getByRole('button', { name: 'Close research transfer' });
        const childLast = screen.getByRole('button', { name: 'Download research' });

        await waitFor(() => expect(childClose).toHaveFocus());
        view.rerender(<NavigationLauncher />);
        await waitFor(() => expect(childClose).toHaveFocus());
        await user.tab({ shift: true });
        expect(childLast).toHaveFocus();
        await user.tab();
        expect(childClose).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Research transfer' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
        await waitFor(() => expect(researchOpener).toHaveFocus());
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
        await waitFor(() => expect(navigationOpener).toHaveFocus());
    } finally {
        visibleElements.mockRestore();
    }
});
