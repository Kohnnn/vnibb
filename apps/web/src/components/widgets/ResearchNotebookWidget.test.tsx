import { act, fireEvent, render, screen } from '@testing-library/react'

import { ResearchNotebookWidget } from './ResearchNotebookWidget'
import { addNotebookItem, clearNotebook } from '@/lib/researchNotebook'

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: any }) => <div>{children}</div>,
}))
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
}))
jest.mock('@/lib/exportWidget', () => ({
  exportToMarkdown: jest.fn(),
  provenanceToMarkdown: jest.fn(() => ''),
}))
jest.mock('@/lib/widgetRuntime', () => ({
  buildWidgetRuntime: jest.fn((value) => value),
}))

const setLinkedSymbol = jest.fn()

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}))

describe('ResearchNotebookWidget', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setLinkedSymbol.mockClear()
  })

  afterEach(() => {
    act(() => {
      clearNotebook()
    })
  })

  test('refreshes when a browser-local pin is added and cleared', () => {
    render(<ResearchNotebookWidget />)
    expect(screen.getByText('No pinned research yet')).toBeInTheDocument()

    act(() => {
      addNotebookItem({
        kind: 'news',
        title: 'Pinned company news',
        symbol: 'VNM',
        sources: [{ label: 'VNIBB', url: 'https://example.test/news' }],
      })
    })
    expect(screen.getByText('Pinned company news')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View VNM' }))
    expect(setLinkedSymbol).toHaveBeenCalledWith('VNM')

    act(() => {
      clearNotebook()
    })
    expect(screen.getByText('No pinned research yet')).toBeInTheDocument()
  })
})
