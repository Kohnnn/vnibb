import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MobileNav } from './MobileNav';
import { captureAnalyticsEvent } from '@/lib/analytics';

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

    it('keeps all three dismissals: overlay, close button and Escape (#208)', async () => {
        render(
            <MobileNav
                onOpenWidgetLibrary={jest.fn()}
                onOpenAppsLibrary={jest.fn()}
                onOpenPromptsLibrary={jest.fn()}
            />,
        );
        const opener = screen.getByRole('button', { name: 'Open menu' });
        const dismissals = [
            { name: 'overlay', close: () => fireEvent.click(screen.getByRole('button', { name: 'Close navigation overlay' })) },
            { name: 'close button', close: () => fireEvent.click(screen.getByRole('button', { name: 'Close menu' })) },
            { name: 'escape', close: () => fireEvent.keyDown(screen.getByRole('dialog', { name: 'Navigation menu' }), { key: 'Escape' }) },
        ];

        for (const { name, close } of dismissals) {
            fireEvent.click(opener);
            await screen.findByRole('dialog', { name: 'Navigation menu' });
            close();
            await waitFor(() => {
                if (screen.queryByRole('dialog')) throw new Error(`dialog still open after ${name}`);
            });
        }
        expect(captureAnalyticsEvent).toHaveBeenCalledWith('closed', expect.objectContaining({ source: 'overlay_click' }));
    });
});
