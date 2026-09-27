import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MaximizedWidgetPortal } from './MaximizedWidgetPortal';

function PersistedFilterHarness() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  return <>
    <button onClick={() => setOpen(true)}>Maximize screener</button>
    <output aria-label="Persisted filter">{filter}</output>
    <MaximizedWidgetPortal isOpen={open} title="Screener" onClose={() => setOpen(false)}>
      <input aria-label="Screener filter" value={filter} onChange={event => setFilter(event.target.value)} />
      <iframe title="Market embed" src="about:blank" />
    </MaximizedWidgetPortal>
  </>;
}

test('persisted typing retains focus through parent renders and restores the opening control on close', async () => {
  const user = userEvent.setup();
  render(<PersistedFilterHarness />);
  const opener = screen.getByRole('button', { name: 'Maximize screener' });
  await user.click(opener);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Minimize widget' })).toHaveFocus());
  const input = screen.getByRole('textbox', { name: 'Screener filter' });
  await user.type(input, 'banking');
  expect(input).toHaveFocus();
  expect(screen.getByLabelText('Persisted filter')).toHaveTextContent('banking');
  await user.type(input, ' sector');
  expect(input).toHaveFocus();
  expect(screen.getByLabelText('Persisted filter')).toHaveTextContent('banking sector');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test('reverse tab from the close control reaches an embedded iframe', async () => {
  render(<PersistedFilterHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Maximize screener' }));
  const close = screen.getByRole('button', { name: 'Minimize widget' });
  await waitFor(() => expect(close).toHaveFocus());
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(screen.getByTitle('Market embed')).toHaveFocus();
});
