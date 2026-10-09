import { fireEvent, render, screen } from '@testing-library/react';
import { WidgetLibrary } from './WidgetLibrary';

jest.mock('@/contexts/DashboardContext', () => ({
    useDashboard: () => ({
        activeDashboard: { id: 'personal', name: 'Personal', isEditable:true },
        activeTab: { id: 'tab', name: 'Tab', widgets:[] },
        addWidget: jest.fn(),
    }),
}));

jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));

// #109: an unmatched search left the drawer blank with no recovery affordance,
// and Escape dismissal did not return focus to the opener.
describe('WidgetLibrary drawer recovery', () => {
    it('states that nothing matched and offers a way back', () => {
        render(<WidgetLibrary isOpen onClose={jest.fn()} />);

        fireEvent.change(screen.getByPlaceholderText('Search widgets, bundles, or data sources...'), {
            target: { value: 'zzz-no-such-widget' },
        });

        expect(screen.getByText(/No widgets match/)).toBeInTheDocument();

        const clearSearch = screen.getByRole('button', { name: 'Clear search' });
        clearSearch.focus();
        fireEvent.click(clearSearch);

        expect(screen.queryByText(/No widgets match/)).not.toBeInTheDocument();
        expect(screen.getByText('Recommended Bundles')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search widgets, bundles, or data sources...')).toHaveFocus();
    });

    it('closes on Escape and returns focus to the control that opened it', () => {
        const onClose = jest.fn();
        const opener = document.createElement('button');
        opener.textContent = 'Open widgets';
        document.body.appendChild(opener);

        const { rerender } = render(<WidgetLibrary isOpen={false} onClose={onClose} />);

        opener.focus();
        expect(document.activeElement).toBe(opener);

        rerender(<WidgetLibrary isOpen onClose={onClose} />);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(<WidgetLibrary isOpen={false} onClose={onClose} />);
        expect(document.activeElement).toBe(opener);

        opener.remove();
    });
});
