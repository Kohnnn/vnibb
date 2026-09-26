import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { WidgetToolbar } from './WidgetToolbar';

jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));

let width = 360;
let observers: Array<() => void> = [];
const OriginalResizeObserver = global.ResizeObserver;

beforeEach(() => {
  width = 360;
  observers = [];
  global.ResizeObserver = class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 36, top: 0, left: 0, bottom: 36, right: width, x: 0, y: 0, toJSON() {} }));
  jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(260);
});

afterEach(() => {
  global.ResizeObserver = OriginalResizeObserver;
  jest.restoreAllMocks();
});

function ToolbarHarness() {
  const [period, setPeriod] = useState('1Y');
  const [settings, setSettings] = useState(false);
  return <>
    <WidgetToolbar title="Long company price history" onSettings={() => setSettings(true)} onMaximize={() => {}} parameters={<select aria-label="Period" value={period} onChange={event => setPeriod(event.target.value)}><option>1Y</option><option>5Y</option></select>} />
    <output aria-label="Selected period">{period}</output>
    {settings && <div role="dialog" aria-label="Settings editor" />}
  </>;
}

test('compact controls retain parameter edits and settings access, returning focus on Escape', () => {
  render(<ToolbarHarness />);
  const trigger = screen.getByRole('button', { name: 'More controls for Long company price history' });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Long company price history controls' });
  fireEvent.change(within(panel).getByRole('combobox', { name: 'Period' }), { target: { value: '5Y' } });
  expect(screen.getByLabelText('Selected period')).toHaveTextContent('5Y');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Long company price history controls' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Widget settings' }));
  expect(screen.getByRole('dialog', { name: 'Settings editor' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Long company price history controls' })).not.toBeInTheDocument();

  act(() => { width = 900; observers.forEach(callback => callback()); });
  expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('5Y');
  expect(screen.queryByRole('button', { name: 'More controls for Long company price history' })).not.toBeInTheDocument();
});

test.each(['mouseDown', 'pointerDown', 'touchStart'] as const)('compact parameter %s cannot start its surrounding grid drag', eventName => {
  function GridDragHarness() {
    const [dragging, setDragging] = useState(false);
    return <div onMouseDown={() => setDragging(true)} onPointerDown={() => setDragging(true)} onTouchStart={() => setDragging(true)}>
      <output aria-label="Grid drag state">{dragging ? 'dragging' : 'idle'}</output>
      <ToolbarHarness />
    </div>;
  }
  render(<GridDragHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'More controls for Long company price history' }));
  fireEvent[eventName](screen.getByRole('combobox', { name: 'Period' }));
  expect(screen.getByLabelText('Grid drag state')).toHaveTextContent('idle');
});
