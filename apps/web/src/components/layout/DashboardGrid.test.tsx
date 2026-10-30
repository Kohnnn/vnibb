import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DashboardGrid, type LayoutItem } from './DashboardGrid';

jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: () => {} }));
jest.mock('react-grid-layout', () => ({
  ...jest.requireActual('react-grid-layout'),
  GridLayout: ({ layout, onDragStop, onResizeStop, children }: {
    layout: LayoutItem[];
    onDragStop: (layout: LayoutItem[]) => void;
    onResizeStop: (layout: LayoutItem[]) => void;
    children: React.ReactNode;
  }) => <div>
    <output aria-label="Visible layout">{JSON.stringify(layout.map(({ i, x, y, w, h }: LayoutItem) => ({ i, x, y, w, h })))}</output>
    <button onClick={() => onDragStop([{ i: 'chart', x: 2, y: 12, w: 10, h: 9 }])}>Drag chart</button>
    <button onClick={() => onResizeStop([{ i: 'chart', x: 2, y: 12, w: 14, h: 11 }])}>Resize chart</button>
    {children}
  </div>,
}));

const authored: LayoutItem[] = [{ i: 'chart', x: 2, y: 12, w: 10, h: 9 }];
function WorkspaceHarness() {
  const [layout, setLayout] = useState(authored);
  const [editing, setEditing] = useState(false);
  return <>
    <button onClick={() => setEditing(value => !value)}>Toggle editing</button>
    <output aria-label="Saved layout">{JSON.stringify(layout)}</output>
    <DashboardGrid layouts={layout} isEditing={editing} onLayoutChange={setLayout}><div key="chart">Chart</div></DashboardGrid>
  </>;
}

test('view and responsive transitions preserve authored gaps, and only desktop edits can save geometry', () => {
  jest.useFakeTimers();
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 900));
  let resizeCallback: ResizeObserverCallback;
  jest.spyOn(globalThis, 'ResizeObserver').mockImplementation(callback => {
    resizeCallback = callback;
    return { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
  });
  const resizeGrid = (width: number) => act(() => {
    resizeCallback([{ contentRect: new DOMRect(0, 0, width, 900) } as ResizeObserverEntry], {} as ResizeObserver);
    jest.advanceTimersByTime(100);
  });

  const { container } = render(<WorkspaceHarness />);
  expect(screen.getByLabelText('Visible layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle editing' }));
  resizeGrid(600);
  expect(container.querySelector('.dashboard-grid')).toHaveAttribute('data-grid-editable', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify(authored));
  resizeGrid(1200);
  expect(container.querySelector('.dashboard-grid')).toHaveAttribute('data-grid-editable', 'true');
  expect(screen.getByLabelText('Visible layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify([{ i: 'chart', x: 2, y: 12, w: 14, h: 11 }]));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
