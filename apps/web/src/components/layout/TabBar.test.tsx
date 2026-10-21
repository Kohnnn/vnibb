import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { TabBar } from './TabBar';
import { useDashboard } from '@/contexts/DashboardContext';
import type { Dashboard, DashboardTab } from '@/types/dashboard';
import type { DashboardContextValue } from '@/contexts/DashboardContext/types';

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/lib/analytics', () => ({
    ANALYTICS_EVENTS: { tabManagementOpened: 'tab_management_opened' },
    captureAnalyticsEvent: jest.fn(),
}));

const mockUseDashboard = jest.mocked(useDashboard);

function TabBarWorkspace({ count = 3 }: { count?: number }) {
    const [tabs, setTabs] = useState<DashboardTab[]>(() => Array.from({ length: count }, (_, order) => ({
        id: `tab-${order + 1}`, name: `Research ${order + 1}`, order, widgets: [],
    })));
    const [activeTabId, setActiveTabId] = useState('tab-1');
    const dashboard: Dashboard = {
        id: 'workspace-1', name: 'Research', order: 0, isDefault: false, showGroupLabels: true,
        tabs, syncGroups: [], createdAt: '2026-10-20', updatedAt: '2026-10-20',
    };
    mockUseDashboard.mockReturnValue({
        activeDashboard: dashboard,
        activeTab: tabs.find(tab => tab.id === activeTabId) ?? null,
        setActiveTab: setActiveTabId,
        deleteTab: (_dashboardId: string, tabId: string) => setTabs(current => current.filter(tab => tab.id !== tabId)),
        reorderTabs: (_dashboardId: string, reordered: DashboardTab[]) => setTabs(reordered),
        recentlyClosedTabs: [],
        restoreLastClosedTab: () => null,
    } as unknown as DashboardContextValue);
    return <TabBar />;
}

function tabButtons(): HTMLElement[] {
    return screen.getAllByRole('button', { name: /Research \d+ tab/ });
}

describe('TabBar', () => {
    it('exposes only the current tab and retains button selection and keyboard reordering', () => {
        render(<TabBarWorkspace />);
        const [first, second, third] = tabButtons();
        expect(first).toHaveAttribute('aria-current', 'page');
        expect(second).not.toHaveAttribute('aria-current');
        expect(third).not.toHaveAttribute('aria-current');

        second.focus();
        fireEvent.keyDown(second, { key: 'Enter' });
        expect(second).toHaveAttribute('aria-current', 'page');
        expect(first).not.toHaveAttribute('aria-current');
        expect(second).toHaveFocus();
        fireEvent.keyDown(second, { key: 'ArrowLeft', altKey: true });
        expect(tabButtons()).toEqual([second, first, third]);
        expect(second).toHaveFocus();
        expect(second).toHaveAttribute('aria-current', 'page');
        fireEvent.keyDown(second, { key: 'ArrowLeft', altKey: true });
        expect(tabButtons()).toEqual([second, first, third]);
        fireEvent.keyDown(second, { key: 'ArrowRight', altKey: true });
        expect(tabButtons()).toEqual([first, second, third]);
        fireEvent.keyDown(third, { key: ' ' });
        expect(third).toHaveAttribute('aria-current', 'page');
        fireEvent.click(first);
        expect(first).toHaveAttribute('aria-current', 'page');
        expect(third).not.toHaveAttribute('aria-current');
    });

    it('closes the selected tab only on the second Ctrl W and selects the surviving adjacent tab', () => {
        render(<TabBarWorkspace />);
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        expect(tabButtons()).toHaveLength(3);
        expect(screen.getByTitle('Click again to confirm delete')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        expect(tabButtons()).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /Research 1 tab/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Research 2 tab/ })).toHaveAttribute('aria-current', 'page');

        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        expect(tabButtons()).toHaveLength(1);
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
        expect(tabButtons()).toHaveLength(1);
    });

    it('uses the same twelve-tab ceiling in the bar and Manage Tabs', () => {
        render(<TabBarWorkspace count={12} />);
        expect(screen.getByTitle('Maximum 12 tabs')).toBeDisabled();
        fireEvent.click(screen.getByTitle('Manage tabs'));
        const add = screen.getByRole('button', { name: 'Add New Tab' });
        expect(add).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Research 12' }));
        expect(add).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(tabButtons()).toHaveLength(11);
        expect(screen.getByTitle(/Add new tab/)).toBeEnabled();
    });

    it('saves handle keyboard order without selecting a different active tab', () => {
        render(<TabBarWorkspace />);
        fireEvent.click(screen.getByTitle('Manage tabs'));
        const handle = screen.getAllByRole('button', { name: 'Reorder tab' })[0];
        handle.focus();
        fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
        expect(handle).toHaveFocus();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        const reordered = tabButtons();
        expect(reordered.map(button => button.textContent?.replace(/Ctrl\d|⌘\d/g, ''))).toEqual([
            'Research 2', 'Research 1', 'Research 3',
        ]);
        expect(reordered[1]).toHaveAttribute('aria-current', 'page');
    });
});
