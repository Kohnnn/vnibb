import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent } from 'react'

import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from './dropdown-menu'

function Actions({ onAction = jest.fn() }: { onAction?: () => void }) {
    return <div style={{ overflow: 'hidden' }}>
        <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button">Actions</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem disabled onClick={onAction}>Unavailable</DropdownMenuItem>
                <DropdownMenuItem onClick={onAction}>Settings</DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={onAction}>Export as CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={onAction}>Export as JSON</DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
}

describe('DropdownMenu', () => {
    test('opens from keyboard, navigates enabled items and restores trigger focus on Escape', () => {
        render(<Actions />)
        const trigger = screen.getByRole('button', { name: 'Actions' })
        trigger.focus()
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        const menu = screen.getByRole('menu')
        expect(menu.parentElement).toBe(document.body)
        expect(menu).toHaveStyle({ position: 'fixed' })
        expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Settings' }), { key: 'End' })
        expect(screen.getByRole('menuitem', { name: 'Export' })).toHaveFocus()
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export' }), { key: 'Home' })
        expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Settings' }), { key: 'ArrowUp' })
        expect(screen.getByRole('menuitem', { name: 'Export' })).toHaveFocus()
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export' }), { key: 'Escape' })
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
        fireEvent.keyDown(trigger, { key: 'ArrowUp' })
        expect(screen.getByRole('menuitem', { name: 'Export' })).toHaveFocus()
    })

    test('does not invoke disabled actions and lets action dialogs take focus', () => {
        function DialogAction() {
            const [open, setOpen] = useState(false)
            return <>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button">Actions</button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem disabled onClick={() => setOpen(true)}>Unavailable</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setOpen(true)}>Open dialog</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                {open && <button type="button" ref={node => node?.focus()}>Dialog control</button>}
            </>
        }
        render(<DialogAction />)
        fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Unavailable' }), { key: 'Enter' })
        expect(screen.queryByRole('button', { name: 'Dialog control' })).not.toBeInTheDocument()
        expect(screen.getByRole('menu')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open dialog' }))
        expect(screen.getByRole('button', { name: 'Dialog control' })).toHaveFocus()
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    test('keeps checkbox menu open through pointer and keyboard toggles', () => {
        function Options() {
            const [checked, setChecked] = useState(false)
            return <DropdownMenu>
                <DropdownMenuTrigger>Options</DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>Show labels</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>
        }
        render(<Options />)
        fireEvent.click(screen.getByRole('button', { name: 'Options' }))
        const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Show labels' })
        fireEvent.click(checkbox)
        expect(checkbox).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('menu')).toBeInTheDocument()
        checkbox.focus()
        fireEvent.keyDown(checkbox, { key: ' ' })
        expect(checkbox).toHaveAttribute('aria-checked', 'false')
        expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    test('opens nested export actions by touch-like click and keyboard without clipping', () => {
        const onAction = jest.fn()
        render(<Actions onAction={onAction} />)
        fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }))
        expect(screen.getByRole('menuitem', { name: 'Export as CSV' })).toBeVisible()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Export as CSV' }))
        expect(onAction).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        const trigger = screen.getByRole('button', { name: 'Actions' })
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        const submenuTrigger = screen.getByRole('menuitem', { name: 'Export' })
        submenuTrigger.focus()
        fireEvent.keyDown(submenuTrigger, { key: 'ArrowRight' })
        const nestedItem = screen.getByRole('menuitem', { name: 'Export as CSV' })
        expect(nestedItem).toHaveFocus()
        fireEvent.keyDown(nestedItem, { key: 'ArrowLeft' })
        expect(submenuTrigger).toHaveFocus()
        fireEvent.keyDown(submenuTrigger, { key: 'Enter' })
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export as JSON' }), { key: 'Enter' })
        expect(onAction).toHaveBeenCalledTimes(2)
    })

    test('respects asChild cancellation and preserves the child ref', () => {
        const ref = { current: null as HTMLButtonElement | null }
        const childKey = jest.fn((event: KeyboardEvent) => event.preventDefault())
        render(<DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" ref={ref} onClick={event => event.preventDefault()} onKeyDown={childKey}>Actions</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem>Action</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>)
        const trigger = screen.getByRole('button', { name: 'Actions' })
        expect(ref.current).toBe(trigger)
        fireEvent.click(trigger)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        expect(childKey).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    test('composes asChild handlers and closes for outside pointer and browser history navigation', () => {
        const childClick = jest.fn()
        render(<DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" onClick={childClick}>Actions</button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem>Action</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>)
        const trigger = screen.getByRole('button', { name: 'Actions' })
        fireEvent.click(trigger)
        expect(childClick).toHaveBeenCalledTimes(1)
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        fireEvent.pointerDown(document.body)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        fireEvent.click(trigger)
        fireEvent.popState(window)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
})
