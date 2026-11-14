import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetLibrary } from './WidgetLibrary';

const mockAddWidget = jest.fn();
let mockEditable = true;

jest.mock('@/contexts/DashboardContext', () => ({
    useDashboard: () => ({
        activeDashboard: { id: 'personal', name: 'Personal', isEditable: mockEditable },
        activeTab: { id: 'tab', name: 'Tab', widgets: [] },
        addWidget: mockAddWidget,
    }),
}));

jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));

beforeEach(() => { mockEditable = true; mockAddWidget.mockClear(); });

// #261: the drawer overlaid the workspace but its own controls were only the
// first stop — Shift+Tab reached the icon-only X, a second Shift+Tab escaped to
// the obscured dashboard, and Escape then restored that escaped element instead
// of the Widgets opener.
describe('WidgetLibrary modal containment', () => {
    it('names the close control and wraps Tab in both directions inside the drawer', async () => {
        jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
        const user = userEvent.setup();
        try {
            render(<WidgetLibrary isOpen onClose={jest.fn()} />);
            const drawer = screen.getByRole('dialog', { name: 'Add widgets' });
            expect(drawer).toHaveAttribute('aria-modal', 'true');
            expect(screen.getByRole('button', { name: 'Close widget library' })).toBeInTheDocument();

            const search = screen.getByPlaceholderText('Search widgets, bundles, or data sources...');
            await waitFor(() => expect(search).toHaveFocus());

            // Backwards from the first control wraps to the last one, not out of the drawer.
            await user.tab({ shift: true });
            expect(drawer).toContainElement(document.activeElement as HTMLElement);

            // Forward from the last control wraps back to the first.
            const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
                'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ));
            const last = focusable[focusable.length - 1];
            last.focus();
            await user.tab();
            expect(document.activeElement).toBe(focusable[0]);
            expect(drawer).toContainElement(document.activeElement as HTMLElement);
        } finally {
            jest.restoreAllMocks();
        }
    });

    it('reclaims background focus while open and returns it to the opener on Escape', async () => {
        jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
        const onClose = jest.fn();
        try {
            const opener = document.createElement('button');
            opener.textContent = 'Open widgets';
            const background = document.createElement('button');
            background.textContent = 'Fundamental Analysis';
            document.body.append(opener, background);

            const { rerender } = render(<WidgetLibrary isOpen={false} onClose={onClose} />);
            opener.focus();
            rerender(<WidgetLibrary isOpen onClose={onClose} />);

            const drawer = screen.getByRole('dialog', { name: 'Add widgets' });
            await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

            // A programmatic background focus (the escape the ticket recorded) is
            // pulled back in, and it must not become the remembered opener.
            background.focus();
            await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

            fireEvent.keyDown(drawer, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
            rerender(<WidgetLibrary isOpen={false} onClose={onClose} />);
            expect(opener).toHaveFocus();

            opener.remove();
            background.remove();
        } finally {
            jest.restoreAllMocks();
        }
    });

    it('keeps a read-only workspace non-insertable and clears the selection when dismissed', async () => {
        jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
        mockEditable = false;
        try {
            const { rerender } = render(<WidgetLibrary isOpen onClose={jest.fn()} />);

            const addButtons = screen.getAllByRole('button', { name: 'Add' });
            expect(addButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);
            fireEvent.click(addButtons[0]);
            expect(mockAddWidget).not.toHaveBeenCalled();

            // Selection state is dropped on dismissal, so a reopen starts clean.
            mockEditable = true;
            rerender(<WidgetLibrary isOpen onClose={jest.fn()} />);
            fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select / })[0]);
            expect(screen.getByText(/1 selected/)).toBeInTheDocument();
            rerender(<WidgetLibrary isOpen={false} onClose={jest.fn()} />);
            rerender(<WidgetLibrary isOpen onClose={jest.fn()} />);
            expect(screen.queryByText(/1 selected/)).not.toBeInTheDocument();
        } finally {
            jest.restoreAllMocks();
        }
    });
});
