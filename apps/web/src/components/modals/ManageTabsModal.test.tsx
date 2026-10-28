import { fireEvent, render, screen, within } from '@testing-library/react';

import { ManageTabsModal } from './ManageTabsModal';
import type { DashboardTab } from '@/types/dashboard';

function makeTabs(count: number): DashboardTab[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `tab-${index + 1}`,
        name: `Research ${index + 1}`,
        order: index * 2,
        widgets: [{
            id: `widget-${index + 1}`,
            type: 'ticker_info',
            tabId: `tab-${index + 1}`,
            config: { symbol: 'VNM' },
            layout: { i: `widget-${index + 1}`, x: 0, y: 0, w: 4, h: 4 },
        }],
    }));
}

function tabNames(): string[] {
    return screen.getAllByRole('textbox', { name: 'Tab name' }).map(input => (input as HTMLInputElement).value);
}

describe('ManageTabsModal', () => {
    it('stops at twelve tabs and permits one replacement after deletion', () => {
        const tabs = makeTabs(12);
        const onSave = jest.fn();
        render(<ManageTabsModal isOpen onClose={jest.fn()} tabs={tabs} onSave={onSave} />);

        const add = screen.getByRole('button', { name: 'Add New Tab' });
        expect(add).toBeDisabled();
        fireEvent.click(add);
        expect(tabNames()).toHaveLength(12);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Research 5' }));
        expect(add).toBeEnabled();
        fireEvent.click(add);
        expect(add).toBeDisabled();
        expect(tabNames()).toEqual([
            'Research 1', 'Research 2', 'Research 3', 'Research 4', 'Research 6', 'Research 7',
            'Research 8', 'Research 9', 'Research 10', 'Research 11', 'Research 12', 'New Tab',
        ]);
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        const saved = onSave.mock.calls[0][0] as DashboardTab[];
        expect(saved.map(tab => tab.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(saved.find(tab => tab.id === 'tab-6')?.widgets).toEqual(tabs[5].widgets);
    });

    it('preserves every legacy over-limit tab on save without permitting additions', () => {
        const tabs = makeTabs(13);
        const onSave = jest.fn();
        render(<ManageTabsModal isOpen onClose={jest.fn()} tabs={tabs} onSave={onSave} />);

        expect(tabNames()).toHaveLength(13);
        expect(screen.getByRole('button', { name: 'Add New Tab' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledWith(tabs.map((tab, order) => ({ ...tab, order })));
    });

    it('moves a focused handle with Alt arrows, retains widgets and saves contiguous order at boundaries', () => {
        const tabs = makeTabs(3);
        const onSave = jest.fn();
        const onClose = jest.fn();
        render(<ManageTabsModal isOpen onClose={onClose} tabs={tabs} onSave={onSave} />);

        const handles = screen.getAllByRole('button', { name: 'Reorder tab' });
        const handle = handles[0];
        handle.focus();
        fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true });
        expect(tabNames()).toEqual(['Research 1', 'Research 2', 'Research 3']);
        expect(handle).toHaveFocus();
        fireEvent.keyDown(handle, { key: 'ArrowDown' });
        expect(tabNames()).toEqual(['Research 1', 'Research 2', 'Research 3']);

        fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
        expect(tabNames()).toEqual(['Research 2', 'Research 1', 'Research 3']);
        expect(handle).toHaveFocus();
        expect(screen.getAllByRole('button', { name: 'Reorder tab' })[1]).toBe(handle);
        fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
        fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
        expect(tabNames()).toEqual(['Research 2', 'Research 3', 'Research 1']);
        expect(handle).toHaveFocus();
        fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true });
        expect(tabNames()).toEqual(['Research 2', 'Research 1', 'Research 3']);
        expect(handle).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledWith([
            { ...tabs[1], order: 0 }, { ...tabs[0], order: 1 }, { ...tabs[2], order: 2 },
        ]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps pointer dragging and the last remaining tab intact', () => {
        const tabs = makeTabs(2);
        const onSave = jest.fn();
        render(<ManageTabsModal isOpen onClose={jest.fn()} tabs={tabs} onSave={onSave} />);
        const rows = screen.getAllByRole('textbox', { name: 'Tab name' }).map(input => input.parentElement!);
        fireEvent.dragStart(rows[0]);
        fireEvent.dragOver(rows[1]);
        fireEvent.dragEnd(rows[0]);
        expect(tabNames()).toEqual(['Research 2', 'Research 1']);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Research 1' }));
        expect(within(rows[1]).getByRole('button', { name: 'Delete Research 2' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledWith([{ ...tabs[1], order: 0 }]);
    });
});
