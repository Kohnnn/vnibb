import { useEffect, useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MaximizedWidgetPortal } from '../MaximizedWidgetPortal';
import { MatrixInspector } from './MatrixInspector';
import type { MatrixSnapshot } from '@/types/matrix';

// #236: at 1024px the inline inspector's Close owns focus; resizing to 321px
// reparents the same inspector into a body portal. The child trap then attached
// while document.activeElement was BODY, so Escape closed the inspector but
// dropped focus onto BODY — outside the still-open maximized Matrix — and a
// second Escape did nothing.
class ControllableMediaQuery {
  matches: boolean;
  private listeners = new Set<() => void>();
  constructor(matches: boolean) { this.matches = matches; }
  addEventListener = (_type: string, listener: () => void) => { this.listeners.add(listener); };
  removeEventListener = (_type: string, listener: () => void) => { this.listeners.delete(listener); };
  set(matches: boolean) { this.matches = matches; this.listeners.forEach((listener) => listener()); }
}

const snapshot: MatrixSnapshot = {
  schema_version: 'matrix-v1', matrix_id: 'matrix-1', snapshot_id: 'snapshot-1', revision: 'revision-1',
  created_at: '2025-12-31T00:00:00Z', synthetic: true, anchor_symbol: 'DEMO_A', playbook_id: 'nonfinancial',
  definition_revision: 'definition-1', period: '2025', period_type: 'year',
  entities: [{ entity_id: 'DEMO_A', symbol: 'DEMO_A', name: 'Demo A', sector: 'Technology' }],
  dimensions: [{ dimension_id: 'profit', label: 'Profit quality', question: 'Is profit supported?', output_type: 'table', source_scope: 'Stored statements', definition_revision: 'definition-1' }],
  cells: [{
    result_id: 'result-DEMO_A', entity_id: 'DEMO_A', dimension_id: 'profit', result_revision: 'revision-1', state: 'unavailable',
    payload: { kind: 'table', metrics: [{ key: 'profit', label: 'Profit', value: null, display: 'Unavailable', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: [] }] },
    evidence_ids: [], basis: 'Consolidated', limitations: [], review_state: 'unreviewed',
  }],
  limitations: ['Stored observations, not original filings.'],
};

function ResponsiveHarness() {
  const [maximized, setMaximized] = useState(false);
  const [inspected, setInspected] = useState(false);
  // Mirrors MatrixWidget: the Inspect control is captured when it opens and
  // restored after the inspector unmounts.
  const focusOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (inspected || !focusOrigin.current) return;
    const target = focusOrigin.current;
    if (target.isConnected) target.focus({ preventScroll: true });
  }, [inspected]);
  return <>
    <button onClick={() => setMaximized(true)}>Maximize widget</button>
    <MaximizedWidgetPortal isOpen={maximized} title="Matrix workspace" onClose={() => setMaximized(false)}>
      <button onClick={(event) => { focusOrigin.current = event.currentTarget; setInspected(true); }}>Inspect DEMO_A Signed number</button>
      {inspected && <MatrixInspector
        snapshot={snapshot}
        cell={snapshot.cells[0]}
        dimension={snapshot.dimensions[0]}
        canReview={false}
        busy={false}
        onClose={() => setInspected(false)}
        onReview={() => {}}
        onQuarantine={() => false}
      />}
    </MaximizedWidgetPortal>
  </>;
}

async function openInspector(width: 'wide' | 'narrow', media: ControllableMediaQuery) {
  const user = userEvent.setup();
  render(<ResponsiveHarness />);
  const maximizeOpener = screen.getByRole('button', { name: 'Maximize widget' });
  await user.click(maximizeOpener);
  const outer = screen.getByRole('dialog', { name: 'Matrix workspace' });
  await waitFor(() => expect(outer.contains(document.activeElement)).toBe(true));

  const inspect = screen.getByRole('button', { name: 'Inspect DEMO_A Signed number' });
  await user.click(inspect);
  const inspector = screen.getByRole('dialog', { name: 'Profit quality inspector' });
  if (width === 'narrow') {
    expect(inspector).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveFocus());
  } else {
    // Inline it is not modal, but still reports the state explicitly; the
    // reported live reading at 1024px was aria-modal="false".
    expect(inspector).toHaveAttribute('aria-modal', 'false');
  }
  media.set(width === 'narrow');
  return { user, maximizeOpener, inspect, outer };
}

describe.each([
  ['narrow to wide', 'narrow' as const, 'wide' as const],
  ['wide to narrow', 'wide' as const, 'narrow' as const],
])('Matrix inspector across the 767/768 boundary (%s)', (_label, opened, resized) => {
  it('keeps focus contained, then unwinds inspector before the maximized widget', async () => {
    const visible = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
    const media = new ControllableMediaQuery(opened === 'narrow');
    jest.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    try {
      const { user, maximizeOpener, inspect, outer } = await openInspector(opened, media);
      // Cross the breakpoint with the inspector open. The reparent is a React
      // state update, so wait for the new node rather than reuse the old one.
      media.set(resized === 'narrow');
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'Profit quality inspector' }))
        .toHaveAttribute('aria-modal', resized === 'narrow' ? 'true' : 'false'));
      const inspector = screen.getByRole('dialog', { name: 'Profit quality inspector' });
      await waitFor(() => expect(inspector.contains(document.activeElement)).toBe(true));

      // First Escape closes only the inspector and lands inside the still-open Matrix.
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Profit quality inspector' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Matrix workspace' })).toBeInTheDocument();
      await waitFor(() => expect(inspect).toHaveFocus());
      expect(outer.contains(document.activeElement)).toBe(true);

      // Second Escape closes the maximized widget and restores its opener.
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Matrix workspace' })).not.toBeInTheDocument();
      await waitFor(() => expect(maximizeOpener).toHaveFocus());
    } finally {
      visible.mockRestore();
      jest.restoreAllMocks();
    }
  });
});
