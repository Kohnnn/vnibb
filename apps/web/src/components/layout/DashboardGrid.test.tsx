import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardGrid, type LayoutItem } from './DashboardGrid';

jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: () => {} }));
jest.mock('react-grid-layout', () => ({
  Responsive: ({ layouts, onDragStop, onResizeStop, onBreakpointChange, children }: {
    layouts: { lg: LayoutItem[] };
    onDragStop: (layout: LayoutItem[]) => void;
    onResizeStop: (layout: LayoutItem[]) => void;
    onBreakpointChange: (breakpoint: string) => void;
    children: React.ReactNode;
  }) => <div>
    <output aria-label="Visible desktop layout">{JSON.stringify(layouts.lg.map(({ i, x, y, w, h }: LayoutItem) => ({ i, x, y, w, h })))}</output>
    <button onClick={() => onBreakpointChange('sm')}>Narrow viewport</button>
    <button onClick={() => onBreakpointChange('lg')}>Desktop viewport</button>
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
  render(<WorkspaceHarness />);
  expect(screen.getByLabelText('Visible desktop layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle editing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Narrow viewport' }));
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Desktop viewport' }));
  expect(screen.getByLabelText('Visible desktop layout')).toHaveTextContent(JSON.stringify(authored));
  fireEvent.click(screen.getByRole('button', { name: 'Resize chart' }));
  expect(screen.getByLabelText('Saved layout')).toHaveTextContent(JSON.stringify([{ i: 'chart', x: 2, y: 12, w: 14, h: 11 }]));
});
