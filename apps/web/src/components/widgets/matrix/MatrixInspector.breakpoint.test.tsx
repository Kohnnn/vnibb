import { Fragment, useEffect, useRef, useState } from 'react';
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

// Two Matrix widgets each holding a retained inspector that turns narrow. The
// background owner must be the topmost dialog only, so the older inspector's
// portal is inert while the newer one is open and regains the background when
// the newer one closes — never both portals reachable at once.
function TwoInspectorHarness() {
  const [inspected, setInspected] = useState<readonly string[]>([]);
  // One stable ref per widget, like MatrixWidget's focusOrigin: the older
  // inspector must still restore its own opener after the newer one unwinds.
  const origins = { A: useRef<HTMLButtonElement>(null), B: useRef<HTMLButtonElement>(null) };
  return <>
    {(['A', 'B'] as const).map((id) => <Fragment key={id}>
      <button ref={origins[id]} onClick={() => setInspected((ids) => [...ids, id])}>Inspect {id} Signed number</button>
      {inspected.includes(id) && <MatrixInspector
        snapshot={snapshot}
        cell={snapshot.cells[0]}
        dimension={snapshot.dimensions[0]}
        canReview={false}
        busy={false}
        onClose={() => setInspected((ids) => ids.filter((open) => open !== id))}
        onReview={() => {}}
        onQuarantine={() => false}
        returnFocusTo={origins[id]}
      />}
    </Fragment>)}
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

// The live 390px reading: the narrow inspector was aria-modal but the maximized
// Matrix underneath stayed keyboard- and AT-reachable, so background focus sat
// outside the inspector and Escape never reached it.
it('makes the maximized background inert while the narrow inspector is modal, restoring it after close', async () => {
  const visible = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
  jest.spyOn(window, 'matchMedia').mockReturnValue(new ControllableMediaQuery(true) as unknown as MediaQueryList);
  const user = userEvent.setup();
  // A host may already carry an inert branch; its exact value must round-trip.
  const preInerted = document.createElement('div');
  preInerted.setAttribute('inert', 'inert');
  document.body.appendChild(preInerted);
  try {
    render(<ResponsiveHarness />);
    const maximizeOpener = screen.getByRole('button', { name: 'Maximize widget' });
    await user.click(maximizeOpener);
    const outer = screen.getByRole('dialog', { name: 'Matrix workspace' });
    // A host may already have inerted a card; that exact state must come back.
    const maximizedLayer = outer.parentElement!;
    maximizedLayer.setAttribute('aria-hidden', 'false');

    const inspect = screen.getByRole('button', { name: 'Inspect DEMO_A Signed number' });
    await user.click(inspect);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveFocus());

    expect(outer.closest('[inert]')).not.toBeNull();
    expect(outer.closest('[aria-hidden="true"]')).not.toBeNull();
    // The inspector's own portal root is the only body child left reachable.
    expect(document.querySelector('[data-matrix-inspector-portal]')?.hasAttribute('inert')).toBe(false);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Profit quality inspector' })).not.toBeInTheDocument();
    await waitFor(() => expect(inspect).toHaveFocus());
    // Only the pre-existing branch keeps `inert`, with its original value.
    expect(document.querySelectorAll('[inert]')).toHaveLength(1);
    expect(document.querySelector('[inert]')).toBe(preInerted);
    expect(maximizedLayer.getAttribute('aria-hidden')).toBe('false');
    expect(maximizedLayer.hasAttribute('inert')).toBe(false);
  } finally {
    preInerted.remove();
    visible.mockRestore();
    jest.restoreAllMocks();
  }
});

// Two retained inspectors crossing to narrow together must not both claim the
// background: only the topmost dialog's branch stays reachable, and unwinding
// it hands the background back to the older inspector instead of tearing down.
it('keeps only the topmost of two narrow inspectors reachable, handing the background back as each closes', async () => {
  const visible = jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList);
  const media = new ControllableMediaQuery(false);
  jest.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const user = userEvent.setup();
  // Inline (non-modal) inspectors are legitimate side by side; record the
  // untouched tree so the final close can prove byte-exact restoration.
  const bodyChildrenBefore = Array.from(document.body.children).map((element) => ({
    element, inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden'),
  }));
  try {
    render(<TwoInspectorHarness />);
    const inspectA = screen.getByRole('button', { name: 'Inspect A Signed number' });
    await user.click(inspectA);
    const inspectB = screen.getByRole('button', { name: 'Inspect B Signed number' });
    await user.click(inspectB);
    const [inspectorA, inspectorB] = screen.getAllByRole('dialog', { name: 'Profit quality inspector' });
    expect(inspectorA).not.toBe(inspectorB);
    // Wide: both inline and non-modal, so neither writes the background.
    expect(inspectorA).toHaveAttribute('aria-modal', 'false');
    expect(inspectorB).toHaveAttribute('aria-modal', 'false');
    expect(document.querySelector('[inert]')).toBeNull();

    // Both retained inspectors reparent into body portals at the breakpoint, so
    // every node must be re-queried: the inline elements are gone.
    media.set(true);
    await waitFor(() => {
      // The older portal is aria-hidden by then, so role queries skip it: count
      // every portal branch in the DOM and reach the newer one directly.
      const dialogs = document.querySelectorAll('[data-matrix-inspector-portal] [role="dialog"]');
      expect(dialogs).toHaveLength(2);
      expect(dialogs[1]).toHaveAttribute('aria-modal', 'true');
    });
    const portals = Array.from(document.querySelectorAll('[data-matrix-inspector-portal]'));
    expect(portals).toHaveLength(2);
    const portalA = portals[0];
    const portalB = portals[1];
    // Only the newest portal is exposed to AT; the older branch is inert and
    // hidden, which is why it must be counted from the DOM rather than by role.
    expect(screen.getAllByRole('dialog', { name: 'Profit quality inspector' })).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Profit quality inspector' })).toBe(portalB.querySelector('[role="dialog"]'));
    expect(portalA.hasAttribute('inert')).toBe(true);
    expect(portalA.getAttribute('aria-hidden')).toBe('true');
    expect(portalB.hasAttribute('inert')).toBe(false);
    expect(portalB.hasAttribute('aria-hidden')).toBe(false);
    await waitFor(() => expect(portalB.contains(document.activeElement)).toBe(true));

    await user.keyboard('{Escape}');
    // B closed; A survives, owns the background again and takes focus. A's
    // opener sits in the now-inert root branch, so focus must be handed into A
    // itself rather than stranded on BODY with Escape dead.
    await waitFor(() => expect(document.querySelectorAll('[data-matrix-inspector-portal]')).toHaveLength(1));
    // A is reachable again; only its portal remains.
    expect(screen.getByRole('dialog', { name: 'Profit quality inspector' })).toBe(portalA.querySelector('[role="dialog"]'));
    await waitFor(() => expect(portalA.hasAttribute('inert')).toBe(false));
    expect(portalA.getAttribute('aria-hidden')).toBeNull();
    await waitFor(() => expect(portalA.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Profit quality inspector' })).not.toBeInTheDocument();
    await waitFor(() => expect(inspectA).toHaveFocus());
    for (const { element, inert, ariaHidden } of bodyChildrenBefore) {
      expect(element.hasAttribute('inert')).toBe(inert);
      expect(element.getAttribute('aria-hidden')).toBe(ariaHidden);
    }
  } finally {
    visible.mockRestore();
    jest.restoreAllMocks();
  }
});
