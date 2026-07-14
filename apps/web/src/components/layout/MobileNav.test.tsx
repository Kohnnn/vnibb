import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MobileNav } from './MobileNav';

jest.mock('./Sidebar', () => ({
    Sidebar: () => <a href="/dashboard">Dashboard</a>,
}));

jest.mock('@/lib/analytics', () => ({
    ANALYTICS_EVENTS: { mobileMenuOpened: 'opened', mobileMenuClosed: 'closed' },
    captureAnalyticsEvent: jest.fn(),
}));

describe('MobileNav', () => {
    it('uses a named modal, closes on Escape, and restores focus', async () => {
        render(
            <MobileNav
                onOpenWidgetLibrary={jest.fn()}
                onOpenAppsLibrary={jest.fn()}
                onOpenPromptsLibrary={jest.fn()}
            />,
        );
        const opener = screen.getByRole('button', { name: 'Open menu' });
        expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();

        opener.focus();
        fireEvent.click(opener);
        const dialog = await screen.findByRole('dialog', { name: 'Navigation menu' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: 'Close menu' }).tagName).toBe('BUTTON');

        fireEvent.keyDown(dialog, { key: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
            expect(opener).toHaveFocus();
        });
    });
});
