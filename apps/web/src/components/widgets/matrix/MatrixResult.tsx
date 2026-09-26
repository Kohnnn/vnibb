import type { MatrixCell, MatrixDensity } from '@/types/matrix';

export function MatrixResult({ cell, density = 'standard' }: { cell: MatrixCell; density?: MatrixDensity }) {
  const metrics = cell.payload.metrics ?? [];
  const preview = density === 'compact' ? metrics.slice(0, 1) : density === 'standard' ? metrics.slice(0, 3) : metrics;
  return <div className="matrix-result">
    <span className={`matrix-state matrix-state-${cell.state}`}>{cell.state.replaceAll('_', ' ')}</span>
    {cell.payload.kind === 'table' && <span className="matrix-kind">Table · {metrics.length} metrics</span>}
    {preview.length > 0 && <dl>{preview.map((metric) => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.display}</dd></div>)}</dl>}
    {metrics.length > preview.length && <span className="matrix-muted">+{metrics.length - preview.length} in result</span>}
    {cell.payload.text && <p className={density === 'compact' ? 'matrix-clamp' : undefined}>{cell.payload.text}</p>}
    {cell.payload.labels?.map((label) => <span className="matrix-kind" key={label}>{label}</span>)}
    {cell.payload.kind === 'source_set' && <p>{cell.evidence_ids.length} retained observations · inspect sources</p>}
    {cell.payload.kind === 'artifact' && <p>Artifact reference: {cell.payload.artifact_ref || 'Unavailable'}</p>}
    {cell.state !== 'supported' && !cell.payload.text && <p>{cell.limitations[0] || 'No supported observation is available for this result.'}</p>}
    {density === 'expanded' && <p className="matrix-muted">{cell.basis}</p>}
    {cell.review_state === 'reviewed' && <span className="matrix-kind">Reviewed</span>}
  </div>;
}
