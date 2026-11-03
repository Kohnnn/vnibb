import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { WidgetToolbar } from './WidgetToolbar';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';

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
  const settingsDialogRef = useDialogFocusTrap<HTMLDivElement>({ enabled: settings, onClose: () => setSettings(false) });
  return <>
    <WidgetToolbar title="Long company price history" onSettings={() => setSettings(true)} onMaximize={() => {}} parameters={<select aria-label="Period" value={period} onChange={event => setPeriod(event.target.value)}><option>1Y</option><option>5Y</option></select>} />
    <output aria-label="Selected period">{period}</output>
    {settings && <div ref={settingsDialogRef} role="dialog" aria-label="Settings editor" tabIndex={-1}><button type="button" onClick={() => setSettings(false)}>Close settings</button></div>}
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
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings editor' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Settings editor' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  act(() => { width = 900; observers.forEach(callback => callback()); });
  expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('5Y');
  expect(screen.queryByRole('button', { name: 'More controls for Long company price history' })).not.toBeInTheDocument();
});

test('toolbar uses its grid cell width when expanded content overflows the header', () => {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isExpandedHeader = this.classList.contains('select-none') && !this.querySelector('[aria-label^="More controls for"]');
    const measuredWidth = isExpandedHeader && width < 544 ? 600 : width;
    return { width: measuredWidth, height: 36, top: 0, left: 0, bottom: 36, right: measuredWidth, x: 0, y: 0, toJSON() {} };
  });

  render(<ToolbarHarness />);
  expect(screen.getByRole('button', { name: 'More controls for Long company price history' })).toBeInTheDocument();

  act(() => { width = 900; observers.forEach(callback => callback()); });
  expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument();
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

test.each([360, 180])('compact panel remains inside a %ipx viewport when trigger is near the left edge', viewportWidth => {
  jest.replaceProperty(window, 'innerWidth', viewportWidth);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => Math.min(320, viewportWidth - 16));
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width, height: 36, top: 0, left: 0, bottom: 36, right: 20, x: 0, y: 0, toJSON() {},
  }));
  render(<ToolbarHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'More controls for Long company price history' }));
  const panel = screen.getByRole('dialog', { name: 'Long company price history controls' });
  const panelRight = Number.parseFloat(panel.style.right);
  expect(viewportWidth - panelRight - panel.offsetWidth).toBeGreaterThanOrEqual(0);
  expect(panelRight).toBeGreaterThanOrEqual(0);
});

test('stays compacted once the expanded controls no longer fit, without re-measuring on re-render', async () => {
  // Regression: `parameters`/`actions` are inline JSX rebuilt by the parent every
  // render. Depending on them re-ran the measure effect and rebuilt the
  // ResizeObserver on every render; combined with compact mode removing the
  // controls it measures, the toolbar flipped until React aborted with
  // "Maximum update depth exceeded".
  let compacted = false;
  jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    () => (compacted ? 60 : 400),
  );
  width = 1000;
  const { rerender } = render(<ToolbarHarness />);
  const more = () => screen.queryByRole('button', { name: 'More controls for Long company price history' });
  expect(more()).not.toBeInTheDocument();
  expect(observers).toHaveLength(1);

  // 360 sits between the compact mock measurement (60+60+24=144) and the
  // expanded one (400+400+24=824): below 144 everything stays compact no matter
  // what the threshold holds, so a smaller width would not test preservation.
  width = 360;
  await act(async () => { observers.forEach(notify => notify()); });
  expect(more()).toBeInTheDocument();
  compacted = true;

  for (let i = 0; i < 3; i += 1) {
    rerender(<ToolbarHarness />);
  }
  // Unchanged deps: no effect re-run, so no new observer per render.
  expect(observers).toHaveLength(1);

  // The compact DOM is narrower, but the threshold must survive it.
  await act(async () => { observers.forEach(notify => notify()); });
  expect(more()).toBeInTheDocument();
});
