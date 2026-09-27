'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APIError } from '@/lib/api';
import styles from './MatrixWidget.module.css';
import { matrixApi } from '@/lib/matrix';
import type { MatrixCell, MatrixDimension, MatrixEvidence, MatrixSnapshot } from '@/types/matrix';
import { MatrixResult } from './MatrixResult';

interface Props {
  snapshot: MatrixSnapshot;
  cell: MatrixCell | null;
  dimension: MatrixDimension;
  canReview: boolean;
  busy: boolean;
  onClose: () => void;
  onReview: (cell: MatrixCell) => void;
}

export function MatrixInspector({ snapshot, cell, dimension, canReview, busy, onClose, onReview }: Props) {
  const [tab, setTab] = useState<'Result' | 'Evidence' | 'Basis' | 'Review'>('Result');
  const [evidence, setEvidence] = useState<MatrixEvidence[] | null>(null);
  const [error, setError] = useState('');
  const [narrow, setNarrow] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [narrow]);
  useEffect(() => {
    if (!cell || tab !== 'Evidence') return;
    let active = true;
    setEvidence(null);
    setError('');
    matrixApi.evidence(snapshot, cell.result_id).then((items) => { if (active) setEvidence(items); }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Evidence could not be authorized or loaded.');
      if (!snapshot.synthetic && reason instanceof APIError && [401, 403, 404].includes(reason.status ?? 0)) {
        window.dispatchEvent(new CustomEvent('vnibb:matrix-revoked', { detail: { snapshot_id: snapshot.snapshot_id } }));
      }
    });
    return () => { active = false; };
  }, [snapshot, cell, tab]);

  const content = <aside ref={panel} className="matrix-inspector" role="dialog" aria-modal={narrow} aria-label={`${dimension.label} inspector`} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab' || !narrow) return;
    const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, [tabindex="0"]');
    if (!targets?.length) return;
    const first = targets[0]; const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <header><div><span className="matrix-eyebrow">{cell?.entity_id || 'Research dimension'}</span><h3>{dimension.label}</h3></div><button type="button" onClick={onClose} aria-label="Close inspector">Close</button></header>
    <p>{dimension.question}</p>
    <p className="matrix-muted">{dimension.output_type} · definition {dimension.definition_revision}</p>
    {cell ? <>
      <div className="matrix-tabs" role="tablist" aria-label="Result details">{(['Result', 'Evidence', 'Basis', 'Review'] as const).map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
      <div role="tabpanel" aria-label={tab} className="matrix-inspector-body">
        {tab === 'Result' && <><MatrixResult cell={cell} density="expanded" /><p className="matrix-muted">Result {cell.result_id}<br />Revision {cell.result_revision}</p></>}
        {tab === 'Evidence' && <>
          <p className="matrix-notice">Retained serving observations are not original issuer documents. {snapshot.synthetic && 'These observations are synthetic demonstration data.'}</p>
          {error && <p role="alert">{error}</p>}
          {!evidence && !error && <p role="status">Loading authorized evidence…</p>}
          {evidence?.length === 0 && <p>No evidence retained. See basis and limitations.</p>}
          {evidence?.map((item) => <article className="matrix-evidence" key={item.evidence_id}>
            <strong>{item.field}</strong><p>{item.value ?? 'Unavailable'} {item.unit}</p>
            <dl><div><dt>Source</dt><dd>{item.source}</dd></div><div><dt>Locator</dt><dd>{item.locator}</dd></div><div><dt>Period / as of</dt><dd>{item.period} / {item.as_of || 'Not supplied'}</dd></div><div><dt>Captured</dt><dd>{item.captured_at}</dd></div><div><dt>Provenance</dt><dd>{item.provenance}</dd></div></dl>
            {item.formula && <p>Formula: {item.formula}</p>}{item.input_evidence_ids.length > 0 && <p>Inputs: {item.input_evidence_ids.join(', ')}</p>}
            {item.limitations.map((limit) => <p key={limit} className="matrix-notice">{limit}</p>)}
          </article>)}
        </>}
        {tab === 'Basis' && <><p>{cell.basis}</p><p>Source scope: {dimension.source_scope}</p><ul>{[...snapshot.limitations, ...cell.limitations].map((limit, index) => <li key={`${index}-${limit}`}>{limit}</li>)}</ul>{cell.payload.metrics?.map((metric) => <p key={metric.key}><strong>{metric.label}</strong>: {metric.display} · {metric.period} · {metric.basis}</p>)}</>}
        {tab === 'Review' && <><p>Status: {cell.review_state}</p><p>Review records your acknowledgement, not a verification of source accuracy. The snapshot revision stays unchanged.</p><button type="button" disabled={!canReview || busy} onClick={() => onReview(cell)}>{cell.review_state === 'reviewed' ? 'Mark unreviewed' : 'Mark reviewed'}</button>{!canReview && <p>Sign in and create an owned snapshot to record review.</p>}</>}
      </div>
    </> : <div className="matrix-inspector-body"><h4>Source scope</h4><p>{dimension.source_scope}</p><p>Column visibility, width, and selection only change this view. They do not execute research or fetch provider data.</p></div>}
  </aside>;
  return narrow ? createPortal(<div className={styles.root} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'transparent', padding: 0 }}>{content}</div>, document.body) : content;
}
