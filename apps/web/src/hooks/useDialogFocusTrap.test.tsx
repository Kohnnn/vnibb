import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
            <iframe title="Embedded research" />
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

it('includes an embedded frame when wrapping dialog keyboard focus', async () => {
    const visibleElements = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
    const user = userEvent.setup();
    try {
        render(<NavigationLauncher />);
        await user.click(screen.getByRole('button', { name: 'Open navigation' }));
        const close = screen.getByRole('button', { name: 'Close navigation' });
        const research = screen.getByRole('button', { name: 'Transfer research' });
        const frame = screen.getByTitle('Embedded research') as HTMLIFrameElement;
        await waitFor(() => expect(close).toHaveFocus());

        // Firefox drops a synchronous iframe.focus() inside the trusted keydown.
        const nativeFocus = frame.focus.bind(frame);
        const focusDescriptor = Object.getOwnPropertyDescriptor(frame, 'focus');
        let attempts = 0;
        Object.defineProperty(frame, 'focus', { configurable: true, value: (options?: FocusOptions) => {
            attempts += 1;
            if (attempts === 1) return;
            nativeFocus(options);
        } });

        // Stepping focus elsewhere before the retry (no keydown) keeps the dialog's focusin
        // re-entry out of this timing check, so only the deferred retry can reclaim the frame.
        const nextTask = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });
        try {
            fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
            research.focus();
            await nextTask();
            expect(research).toHaveFocus();

            close.focus();
            attempts = 0;
            await user.tab({ shift: true });
            await waitFor(() => expect(frame).toHaveFocus());
        } finally {
            if (focusDescriptor) Object.defineProperty(frame, 'focus', focusDescriptor);
            else Reflect.deleteProperty(frame, 'focus');
        }
    } finally {
        visibleElements.mockRestore();
    }
});
