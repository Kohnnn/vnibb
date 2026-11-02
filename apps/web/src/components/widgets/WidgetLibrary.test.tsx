import { fireEvent, render, screen, within } from '@testing-library/react';
import { WidgetLibrary } from './WidgetLibrary';

const mockAddWidget = jest.fn();

jest.mock('@/contexts/DashboardContext', () => ({
    useDashboard: () => ({
        activeDashboard: { id: 'personal', name: 'Personal', isEditable:true },
        activeTab: { id: 'tab', name: 'Tab', widgets:[] },
        addWidget: mockAddWidget,
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

function bundleCard(name: string): HTMLElement {
    // Bundle name sits at card > row > name column > label.
    return screen.getByText(name).parentElement!.parentElement!.parentElement!;
}

// The bundle button is the user path that actually inserts widgets. A previous
// regression dropped `market_heatmap` from the pack while the description still
// advertised a heatmap, so assert the click result, not the internal array.
describe('WidgetLibrary bundle insertion', () => {
    beforeEach(() => mockAddWidget.mockClear());

    it('inserts every widget the Market Pulse Pack advertises', () => {
        render(<WidgetLibrary isOpen onClose={jest.fn()} />);

        const card = bundleCard('Market Pulse Pack');
        expect(within(card).getByText('4 widgets')).toBeInTheDocument();
        expect(card).not.toHaveTextContent(/heatmap/i);

        fireEvent.click(within(card).getByRole('button', { name: 'Add' }));

        expect(mockAddWidget.mock.calls.map((call) => call[2].type)).toEqual([
            'market_overview',
            'top_movers',
            'market_breadth',
            'market_news',
        ]);
        expect(mockAddWidget.mock.calls.every((call) => call[0] === 'personal' && call[1] === 'tab')).toBe(true);
    });

    it('stacks inserted widgets downwards instead of overlapping them', () => {
        render(<WidgetLibrary isOpen onClose={jest.fn()} />);

        fireEvent.click(within(bundleCard('Market Pulse Pack')).getByRole('button', { name: 'Add' }));

        const layouts = mockAddWidget.mock.calls.map((call) => call[2].layout);
        expect(layouts[0].y).toBe(0);
        layouts.slice(1).forEach((layout, index) => {
            expect(layout.y).toBeGreaterThanOrEqual(layouts[index].y + layouts[index].h);
            expect(layout.x).toBe(0);
        });
    });
});
