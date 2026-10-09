import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DashboardGrid, type LayoutItem } from './DashboardGrid';

jest.mock('@/hooks/useResizeNudge', () => ({ useResizeNudge: () => {} }));

const authored: LayoutItem[] = [
  { i: 'chart', x: 0, y: 8, w: 8, h: 5 },
  { i: 'table', x: 8, y: 17, w: 8, h: 6 },
];

function AuthoredGrid({ editing, onLayoutChange }: { editing: boolean; onLayoutChange?: (layout: LayoutItem[]) => void }) {
  return <DashboardGrid layouts={authored} isEditing={editing} onLayoutChange={onLayoutChange}>
    <div key="chart" data-testid="chart-cell"><div className="widget-drag-handle">Chart handle</div><button>Chart settings</button></div>
    <div key="table" data-testid="table-cell"><div className="widget-drag-handle">Table handle</div></div>
  </DashboardGrid>;
}

// jsdom has no ResizeObserver; the shared setup installs an inert stub. The grid
// measures its container through it, so widths are driven by hand here.
type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
const resizeObservers = new Set<ResizeCallback>();
class ControllableResizeObserver {
  private readonly callback: ResizeCallback;
  constructor(callback: ResizeCallback) {
    this.callback = callback;
    resizeObservers.add(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() { resizeObservers.delete(this.callback); }
  takeRecords() { return []; }
}
Object.assign(globalThis, { ResizeObserver: ControllableResizeObserver });

const LOCKED_GRID_WIDTH = 1086; // 1124px workspace minus chrome, at lg column geometry
// react-grid-layout: left = round((colWidth + margin) * x), colWidth = (grid - margin * (cols - 1)) / cols.
const lgTranslate = (x: number, y: number) => `translate(${Math.round(((LOCKED_GRID_WIDTH - 6 * 23) / 24 + 6) * x)}px,${(40 + 6) * y}px)`;

async function resizeGridTo(width: number) {
  await act(async () => {
    resizeObservers.forEach(callback => callback([{ contentRect: { width, height: 900 } }]));
    const debounceElapsed = Promise.withResolvers<void>();
    setTimeout(debounceElapsed.resolve, 150); // the grid debounces container measurements by 100ms
    await debounceElapsed.promise;
  });
}

beforeEach(() => { resizeObservers.clear(); });

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

test('a locked desktop width returns to authored lg geometry after every breakpoint crossing', async () => {
  const onLayoutChange = jest.fn();
  render(<AuthoredGrid editing onLayoutChange={onLayoutChange} />);
  const chart = () => screen.getByTestId('chart-cell').style.transform;
  const table = () => screen.getByTestId('table-cell').style.transform;

  await resizeGridTo(LOCKED_GRID_WIDTH);
  const authoredLg = { chart: lgTranslate(0, 8), table: lgTranslate(8, 17) };
  expect(chart()).toBe(authoredLg.chart);
  expect(table()).toBe(authoredLg.table);

  // Re-cross the md/lg boundary at a fixed desktop width. The grid must settle back
  // on the authored lg geometry every time rather than latching the derived md
  // projection (the #108 flap: 403/904/540px alternating with 540/540/540px).
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await resizeGridTo(900);
    expect(chart()).not.toBe(authoredLg.chart);
    await resizeGridTo(LOCKED_GRID_WIDTH);
    expect(chart()).toBe(authoredLg.chart);
    expect(table()).toBe(authoredLg.table);
  }

  // Container measurement is not an edit: nothing may be persisted by resizing.
  expect(onLayoutChange).not.toHaveBeenCalled();
});

test('editability flips on the same width boundary the grid derives its breakpoint from', async () => {
  const { container } = render(<AuthoredGrid editing />);
  const grid = () => container.querySelector('.dashboard-grid');

  await resizeGridTo(1025);
  expect(grid()).toHaveAttribute('data-grid-editable', 'true');

  // 1024 is the `lg` minimum for the shell, but react-grid-layout selects the
  // breakpoint with `width > threshold`, so the grid is already view-only `md` there.
  await resizeGridTo(1024);
  expect(grid()).toHaveAttribute('data-grid-editable', 'false');
});
