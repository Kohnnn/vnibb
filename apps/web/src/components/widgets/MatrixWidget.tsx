'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/contexts/DashboardContext';
import { APIError } from '@/lib/api';
import { boundedMatrixWidth, hiddenMatrixSelectionCount, matrixApi, matrixRequestText, matrixViewFromConfig } from '@/lib/matrix';
import type { MatrixCell, MatrixDimension, MatrixPlaybook, MatrixPreparation, MatrixSnapshot, MatrixView } from '@/types/matrix';
import type { WidgetProps } from './WidgetRegistry';
import { MatrixInspector } from './matrix/MatrixInspector';
import { MatrixResult } from './matrix/MatrixResult';
import styles from './matrix/MatrixWidget.module.css';

function MatrixWidget(props: WidgetProps) {
  const { user } = useAuth();
  const owner = user?.provider === 'supabase' ? user.id : null;
  return <MatrixWorkspace key={owner ?? 'guest'} {...props} owner={owner} />;
}

export { MatrixWidget };

export default MatrixWidget;

function MatrixWorkspace({ id, symbol, onDataChange, owner }: WidgetProps & { owner: string | null }) {
  const { state, updateWidget } = useDashboard();
  const location = useMemo(() => {
    for (const dashboard of state.dashboards) for (const tab of dashboard.tabs) {
      const widget = tab.widgets.find((item) => item.id === id);
      if (widget) return { dashboardId: dashboard.id, tabId: tab.id, widget };
    }
    return null;
  }, [state.dashboards, id]);
  const [view, setView] = useState(() => matrixViewFromConfig(location?.widget.config.matrixView));
  const [anchor, setAnchor] = useState(symbol || 'FPT');
  const [symbols, setSymbols] = useState(symbol || 'FPT');
  const [preparation, setPreparation] = useState<MatrixPreparation | null>(null);
  const [playbooks, setPlaybooks] = useState<MatrixPlaybook[]>([]);
  const [playbook, setPlaybook] = useState('');
  const [period, setPeriod] = useState('');
  const [periodType, setPeriodType] = useState<'year' | 'quarter'>('year');
  const [quarter, setQuarter] = useState('1');
  const [snapshot, setSnapshot] = useState<MatrixSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<{ dimension: MatrixDimension; resultId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState('');
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [savedRef, setSavedRef] = useState(view.snapshotRefs[0] ?? '');
  const generation = useRef(0);
  const mounted = useRef(true);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    let active = true;
    matrixApi.playbooks().then((items) => { if (active) setPlaybooks(items); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Playbooks unavailable.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    onDataChange?.({ companies: snapshot?.entities.length ?? 0, results: snapshot?.cells.length ?? 0, synthetic: snapshot?.synthetic ?? false, __widgetRuntime: { provenance: { apiGroup: '/matrix', endpoint: '/api/v1/matrix', sourceLabel: snapshot?.synthetic ? 'Explicit synthetic fixture' : 'Frozen stored observations', stale: false } } });
  }, [snapshot, onDataChange]);

  const saveView = useCallback((patch: Partial<MatrixView>) => {
    const next = matrixViewFromConfig({ ...viewRef.current, ...patch });
    viewRef.current = next;
    setView(next);
    if (location) updateWidget(location.dashboardId, location.tabId, id, { config: { ...location.widget.config, matrixView: next } });
  }, [location, updateWidget, id]);
  const clearSnapshot = () => {
    setSnapshot(null); setSelected(new Set()); setInspected(null); setFallback(''); setRevokeConfirm(false);
  };
  useEffect(() => {
    const revoked = (event: Event) => {
      const ref = (event as CustomEvent<{ snapshot_id: string }>).detail?.snapshot_id;
      if (!ref) return;
      if (snapshot?.snapshot_id === ref) {
        generation.current += 1;
        setSnapshot(null); setSelected(new Set()); setInspected(null); setFallback(''); setRevokeConfirm(false);
        setNotice('Snapshot revoked. In-memory results and evidence have been removed.');
      }
      if (viewRef.current.snapshotRefs.includes(ref)) saveView({ snapshotRefs: viewRef.current.snapshotRefs.filter((item) => item !== ref) });
    };
    window.addEventListener('vnibb:matrix-revoked', revoked);
    return () => window.removeEventListener('vnibb:matrix-revoked', revoked);
  }, [snapshot?.snapshot_id, saveView]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof APIError && [401, 403, 404].includes(reason.status ?? 0) && snapshot && !snapshot.synthetic) {
        generation.current += 1; clearSnapshot();
      }
      setError(reason instanceof Error ? reason.message : 'The request failed.');
    }
    finally { if (mounted.current) setBusy(false); }
  };
  const openSnapshot = async (load: () => Promise<MatrixSnapshot>) => {
    const ticket = ++generation.current;
    clearSnapshot();
    await run(async () => {
      const next = await load();
      if (!mounted.current || ticket !== generation.current) return;
      setSnapshot(next);
      if (!next.synthetic) {
        saveView({ snapshotRefs: [next.snapshot_id, ...viewRef.current.snapshotRefs.filter((ref) => ref !== next.snapshot_id)].slice(0, 20) });
        setSavedRef(next.snapshot_id);
      }
    });
  };
  const prepare = () => run(async () => {
    const result = await matrixApi.prepare(anchor.trim().toUpperCase());
    if (!mounted.current) return;
    setPreparation(result); setSymbols(result.symbols.join(', ')); setPlaybook(result.playbook_id); setPeriod(result.periods[0] ?? ''); setPeriodType('year');
  });
  const entities = useMemo(() => {
    const query = view.filter.toLocaleLowerCase();
    return (snapshot?.entities ?? []).filter((entity) => `${entity.symbol} ${entity.name}`.toLocaleLowerCase().includes(query)).sort((a, b) => {
      const pin = Number(view.pinned.includes(b.entity_id)) - Number(view.pinned.includes(a.entity_id));
      return pin || a.symbol.localeCompare(b.symbol) * (view.sort === 'reverse' ? -1 : 1);
    });
  }, [snapshot, view.filter, view.sort, view.pinned]);
  const dimensions = snapshot?.dimensions.filter((dimension) => !view.hiddenDimensions.includes(dimension.dimension_id)) ?? [];
  const visibleCells = snapshot?.cells.filter((cell) => entities.some((entity) => entity.entity_id === cell.entity_id) && dimensions.some((dimension) => dimension.dimension_id === cell.dimension_id)) ?? [];
  const cellIndex = useMemo(() => new Map(snapshot?.cells.map((cell) => [`${cell.entity_id}:${cell.dimension_id}`, cell]) ?? []), [snapshot]);
  const requestedSymbols = symbols.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const validScope = requestedSymbols.length >= 2 && requestedSymbols.length <= 10 && new Set(requestedSymbols).size === requestedSymbols.length && requestedSymbols.includes(anchor.trim().toUpperCase());
  const canCreate = !!owner && !!preparation && !!period && !!playbook && validScope && !busy;
  const toggleCell = (resultId: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(resultId)) next.delete(resultId); else if (next.size < 120) next.add(resultId);
    return next;
  });
  const inspect = (dimension: MatrixDimension, cell?: MatrixCell) => {
    focusOrigin.current = document.activeElement as HTMLElement;
    setInspected({ dimension, resultId: cell?.result_id });
  };
  const closeInspector = () => { setInspected(null); focusOrigin.current?.focus(); };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, row: number, col: number, cell: MatrixCell) => {
    if (event.key === ' ') { event.preventDefault(); toggleCell(cell.result_id); return; }
    const offsets: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    grid.current?.querySelector<HTMLButtonElement>(`[data-matrix-cell="${Math.max(0, Math.min(entities.length - 1, row + offset[0]))}:${Math.max(0, Math.min(dimensions.length - 1, col + offset[1]))}"]`)?.focus();
  };
  const exportSelection = (target: 'copy' | 'agent' | 'mcp') => run(async () => {
    if (!snapshot || snapshot.synthetic || !owner) return;
    const current = generation.current;
    const selection = { snapshot_id: snapshot.snapshot_id, result_ids: [...selected] };
    const packet = await matrixApi.selection(selection);
    if (!mounted.current || current !== generation.current) return;
    const text = matrixRequestText(packet);
    if (target === 'agent') {
      window.dispatchEvent(new CustomEvent('vnibb:matrix-followup', { detail: { selection, request_text: text } }));
      setNotice('Selection staged in VniAgent. Review the draft and click Send there.'); return;
    }
    const output = target === 'mcp' ? `Use the official Python MCP ClientSession with HTTP Authorization configured privately for your signed-in account. Never paste credentials into a prompt or tool arguments.\nCall read-only get_matrix_selection with:\n${JSON.stringify(selection, null, 2)}\nThe server reauthorizes ownership and source rights; external export may be denied. Nothing is sent automatically.` : text;
    try { await navigator.clipboard.writeText(output); if (mounted.current) setNotice('Copied. Nothing was sent or executed.'); }
    catch { if (mounted.current) { setFallback(output); setNotice('Clipboard unavailable. Select and copy the text below.'); } }
  });
  const review = (cell: MatrixCell) => run(async () => {
    if (!snapshot) return;
    const current = generation.current;
    const updated = await matrixApi.review({ snapshot_id: snapshot.snapshot_id, result_ids: [cell.result_id] }, cell.review_state === 'reviewed' ? 'unreviewed' : 'reviewed');
    if (mounted.current && current === generation.current) setSnapshot(updated);
  });

  return <section className={styles.root} aria-label="Matrix research workspace">
    <div className="matrix-topline"><div><span className="matrix-eyebrow">VNIBB / RESEARCH</span><h2>Matrix</h2></div><button disabled={busy} type="button" onClick={() => openSnapshot(matrixApi.fixture)}>Explore synthetic fixture</button></div>
    <details className="matrix-scope" open={!snapshot}><summary>Research scope <span className="matrix-muted">· explicit creation only</span></summary>
      <div className="matrix-fields"><label>Anchor company<input value={anchor} maxLength={12} onChange={(event) => { setAnchor(event.target.value.toUpperCase()); setPreparation(null); }} /></label><button disabled={busy || !anchor.trim()} type="button" onClick={prepare}>Prepare peer scope</button><label className="matrix-wide">Companies · maximum 10<input value={symbols} onChange={(event) => setSymbols(event.target.value)} aria-describedby="matrix-peer-basis" /></label></div>
      <p id="matrix-peer-basis" className="matrix-muted">{preparation?.peer_basis || 'Prepare to preselect stored sector peers. You can edit the company list before creating.'}</p>
      <div className="matrix-fields"><label>Sector playbook<select value={playbook} onChange={(event) => setPlaybook(event.target.value)}><option value="">Choose a playbook</option>{playbooks.map((item) => <option key={item.playbook_id} value={item.playbook_id}>{item.label}</option>)}</select></label><label>Period basis<select value={periodType} onChange={(event) => setPeriodType(event.target.value as 'year' | 'quarter')}><option value="year">Common financial year</option><option value="quarter">Quarter</option></select></label><label>Year<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="">No common year selected</option>{preparation?.periods.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>{periodType === 'quarter' && <label>Quarter<select value={quarter} onChange={(event) => setQuarter(event.target.value)}>{['1', '2', '3', '4'].map((q) => <option key={q} value={q}>Q{q}</option>)}</select></label>}<button className="matrix-primary" type="button" disabled={!canCreate} onClick={() => openSnapshot(() => matrixApi.create({ anchor_symbol: anchor.trim().toUpperCase(), symbols: requestedSymbols, playbook_id: playbook, period: periodType === 'quarter' ? `${period}-Q${quarter}` : period, period_type: periodType }))}>Create snapshot</button></div>
      <p className="matrix-muted">{playbooks.find((item) => item.playbook_id === playbook)?.description || 'Sector-specific questions; eligibility is checked against stored company classification.'}</p>
      {preparation?.playbook_id && playbook !== preparation.playbook_id && <p className="matrix-notice">This differs from the anchor’s suggested playbook. Ineligible companies will not be presented as comparable.</p>}
      {preparation?.limitations.map((limit) => <p key={limit} className="matrix-notice">{limit}</p>)}
      {!owner && <p className="matrix-notice">Sign in with a verified account to create or open owned snapshots. The synthetic fixture is available without signing in.</p>}
      {!validScope && <p className="matrix-notice">Include the anchor and between 2 and 10 companies, without duplicates.</p>}
      <p className="matrix-muted">Creation freezes stored observations only. Missing periods or unknown bases remain unavailable; no live provider fetch or background refresh.</p>
    </details>
    {view.snapshotRefs.length > 0 && <div className="matrix-toolbar"><label>Saved snapshot reference<select value={savedRef} onChange={(event) => setSavedRef(event.target.value)}>{view.snapshotRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}</select></label><button type="button" disabled={!owner || busy || !savedRef} onClick={() => openSnapshot(() => matrixApi.snapshot(savedRef))}>Open saved</button></div>}
    {busy && <p role="status" className="matrix-status">Working on your explicit request…</p>}{error && <p role="alert" className="matrix-error">{error}</p>}{notice && <p role="status" className="matrix-notice">{notice}</p>}
    {!snapshot && !busy && view.snapshotRefs.length > 0 && <p className="matrix-muted" role="status">Saved references are listed above. Open one or create a new snapshot — nothing loads automatically.</p>}
    {!snapshot && !busy && <div className="matrix-empty"><h3>Companies × research questions</h3><p>Prepare a peer scope, choose a common period, then create a frozen Matrix. Or explore the clearly labeled synthetic fixture.</p><p>View controls never create or refresh results.</p></div>}
    {snapshot && <>
      <div className={`matrix-provenance ${snapshot.synthetic ? 'matrix-synthetic' : ''}`}><strong>{snapshot.synthetic ? 'SYNTHETIC FIXTURE — not investment evidence' : 'FROZEN SNAPSHOT'}</strong><span>{snapshot.period} · {snapshot.entities.length} companies · {snapshot.cells.length} results</span><span>Captured {snapshot.created_at}</span></div>
      <div className="matrix-toolbar"><label>Filter companies<input value={view.filter} onChange={(event) => saveView({ filter: event.target.value })} /></label><label>Density<select value={view.density} onChange={(event) => saveView({ density: event.target.value as MatrixView['density'] })}><option value="compact">Compact</option><option value="standard">Standard</option><option value="expanded">Expanded</option></select></label><label>Company order<select value={view.sort} onChange={(event) => saveView({ sort: event.target.value as MatrixView['sort'] })}><option value="symbol">A–Z · pinned first</option><option value="reverse">Z–A · pinned first</option></select></label><details><summary>Visible questions</summary>{snapshot.dimensions.map((dimension) => <label key={dimension.dimension_id}><input type="checkbox" checked={!view.hiddenDimensions.includes(dimension.dimension_id)} onChange={(event) => saveView({ hiddenDimensions: event.target.checked ? view.hiddenDimensions.filter((key) => key !== dimension.dimension_id) : [...view.hiddenDimensions, dimension.dimension_id] })} />{dimension.label}</label>)}</details></div>
      <div className="matrix-selection"><strong>{selected.size} selected</strong><span>{hiddenMatrixSelectionCount(selected, visibleCells)} hidden by view</span><button type="button" onClick={() => setSelected(new Set(visibleCells.slice(0, 120).map((cell) => cell.result_id)))}>Select visible</button><button type="button" onClick={() => setSelected(new Set())}>Clear</button>{(['copy', 'agent', 'mcp'] as const).map((target) => <button key={target} disabled={busy || !selected.size || snapshot.synthetic || !owner} type="button" onClick={() => exportSelection(target)}>{target === 'copy' ? 'Copy request' : target === 'agent' ? 'Follow up in VniAgent' : 'Copy MCP instructions'}</button>)}</div>
      {snapshot.synthetic && <p className="matrix-muted">Fixture selection is local practice only. Review and handoff require an owned snapshot.</p>}
      <p className="matrix-keyboard">Arrow keys move between results · Space selects · Enter inspects · Escape closes inspector</p>
      <div className="matrix-workspace"><div className="matrix-grid" ref={grid}><table aria-label="Company research Matrix" className={`matrix-density-${view.density}`}><thead><tr><th scope="col" className="matrix-company">Company</th>{dimensions.map((dimension) => <th key={dimension.dimension_id} scope="col" style={{ minWidth: view.widths[dimension.dimension_id] ?? 240, width: view.widths[dimension.dimension_id] ?? 240 }}><button type="button" className="matrix-dimension" onClick={() => inspect(dimension)}>{dimension.label}<small>{dimension.output_type} · inspect definition</small></button><input type="range" min={140} max={640} step={20} value={view.widths[dimension.dimension_id] ?? 240} aria-label={`Width of ${dimension.label}`} onChange={(event) => saveView({ widths: { ...view.widths, [dimension.dimension_id]: boundedMatrixWidth(event.target.valueAsNumber) } })} /></th>)}</tr></thead><tbody>{entities.map((entity, row) => <tr key={entity.entity_id}><th scope="row" className="matrix-company"><strong>{entity.symbol}</strong><span>{entity.name}</span><button type="button" aria-pressed={view.pinned.includes(entity.entity_id)} aria-label={`${view.pinned.includes(entity.entity_id) ? 'Unpin' : 'Pin'} ${entity.symbol}`} onClick={() => saveView({ pinned: view.pinned.includes(entity.entity_id) ? view.pinned.filter((key) => key !== entity.entity_id) : [...view.pinned, entity.entity_id] })}>{view.pinned.includes(entity.entity_id) ? 'Pinned' : 'Pin'}</button></th>{dimensions.map((dimension, col) => {
        const cell = cellIndex.get(`${entity.entity_id}:${dimension.dimension_id}`);
        return <td key={dimension.dimension_id} className={cell && selected.has(cell.result_id) ? 'matrix-selected' : ''}>{cell ? <><label className="matrix-select-cell"><input type="checkbox" checked={selected.has(cell.result_id)} onChange={() => toggleCell(cell.result_id)} aria-label={`Select ${entity.symbol} ${dimension.label}`} /></label><button type="button" className="matrix-cell" data-matrix-cell={`${row}:${col}`} onKeyDown={(event) => keyboard(event, row, col, cell)} onClick={() => inspect(dimension, cell)} aria-label={`Inspect ${entity.symbol} ${dimension.label}`}><MatrixResult cell={cell} density={view.density} /></button></> : <p className="matrix-notice">Unavailable · no result was retained.</p>}</td>;
      })}</tr>)}</tbody></table>{entities.length === 0 && <p className="matrix-empty">No companies match. Your selected result IDs are retained.</p>}{dimensions.length === 0 && <p className="matrix-empty">Show a question using Visible questions.</p>}</div>
      {inspected && <MatrixInspector key={`${snapshot.snapshot_id}:${inspected.resultId ?? inspected.dimension.dimension_id}`} snapshot={snapshot} cell={snapshot.cells.find((cell) => cell.result_id === inspected.resultId) ?? null} dimension={inspected.dimension} canReview={!!owner && !snapshot.synthetic} busy={busy} onClose={closeInspector} onReview={review} />}</div>
      <details className="matrix-limitations"><summary>Snapshot basis and limitations · {snapshot.limitations.length}</summary><p>Snapshot {snapshot.snapshot_id} · revision {snapshot.revision}</p>{snapshot.limitations.map((limit) => <p key={limit}>{limit}</p>)}</details>
      {!snapshot.synthetic && <div className="matrix-revoke">{!revokeConfirm ? <button type="button" disabled={busy} onClick={() => setRevokeConfirm(true)}>Revoke snapshot…</button> : <><p>Revocation blocks future reads and follow-ups. Previously copied text cannot be recalled.</p><button type="button" disabled={busy} onClick={() => run(async () => {
        const ref = snapshot.snapshot_id;
        await matrixApi.revoke(ref);
        if (!mounted.current) return;
        window.dispatchEvent(new CustomEvent('vnibb:matrix-revoked', { detail: { snapshot_id: ref } }));
        setSavedRef('');
      })}>Confirm revoke</button><button type="button" onClick={() => setRevokeConfirm(false)}>Cancel</button></>}</div>}
    </>}
    {fallback && <label className="matrix-fallback">Copy text manually<textarea readOnly value={fallback} onFocus={(event) => event.target.select()} /><button type="button" onClick={() => setFallback('')}>Clear copied text</button></label>}
  </section>;
}
