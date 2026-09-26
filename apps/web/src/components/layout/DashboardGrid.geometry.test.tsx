import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardGrid, type LayoutItem } from './DashboardGrid';

jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: () => {} }));

const authored: LayoutItem[] = [
  { i: 'chart', x: 0, y: 8, w: 8, h: 5 },
  { i: 'table', x: 8, y: 17, w: 8, h: 6 },
];

function AuthoredGrid({ editing }: { editing: boolean }) {
  return <DashboardGrid layouts={authored} isEditing={editing}>
    <div key="chart" data-testid="chart-cell"><div className="widget-drag-handle">Chart handle</div><button>Chart settings</button></div>
    <div key="table" data-testid="table-cell"><div className="widget-drag-handle">Table handle</div></div>
  </DashboardGrid>;
}

test('the real grid retains deliberate vertical gaps through edit and view transitions', () => {
  const { rerender } = render(<AuthoredGrid editing />);
  // 40px rows plus 6px grid gaps; no compactor may move either cell upward.
  expect(screen.getByTestId('chart-cell').style.transform).toBe('translate(0px,368px)');
  expect(screen.getByTestId('table-cell').style.transform).toBe('translate(402px,782px)');
  rerender(<AuthoredGrid editing={false} />);
  rerender(<AuthoredGrid editing />);
  expect(screen.getByTestId('chart-cell').style.transform).toBe('translate(0px,368px)');
  expect(screen.getByTestId('table-cell').style.transform).toBe('translate(402px,782px)');
});

test('dragging an ordinary widget control does not move its real grid cell', () => {
  render(<AuthoredGrid editing />);
  const cell = screen.getByTestId('chart-cell');
  const initialPosition = cell.style.transform;
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Chart settings' }), { clientX: 30, clientY: 390, buttons: 1 });
  fireEvent.mouseMove(document, { clientX: 150, clientY: 600, buttons: 1 });
  fireEvent.mouseUp(document, { clientX: 150, clientY: 600 });
  expect(cell.style.transform).toBe(initialPosition);
  expect(cell).not.toHaveClass('react-draggable-dragging');
});
