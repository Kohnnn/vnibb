export type MatrixOutputType = 'number' | 'table' | 'text' | 'classification' | 'source_set' | 'artifact';
export type MatrixCellState = 'supported' | 'unavailable' | 'non_comparable' | 'failed' | 'denied';
export type MatrixDensity = 'compact' | 'standard' | 'expanded';

export interface MatrixMetric {
  key: string;
  label: string;
  value: string | null;
  display: string;
  unit: string;
  period: string;
  as_of: string | null;
  basis: string;
  evidence_ids: string[];
}

export interface MatrixDimension {
  dimension_id: string;
  label: string;
  question: string;
  output_type: MatrixOutputType;
  source_scope: string;
  definition_revision: string;
}

export interface MatrixCell {
  result_id: string;
  entity_id: string;
  dimension_id: string;
  result_revision: string;
  state: MatrixCellState;
  payload: {
    kind: MatrixOutputType | 'unavailable';
    text?: string;
    metrics?: MatrixMetric[];
    labels?: string[];
    artifact_ref?: string | null;
  };
  evidence_ids: string[];
  basis: string;
  limitations: string[];
  review_state: 'unreviewed' | 'reviewed';
}

export interface MatrixSnapshot {
  schema_version: 'matrix-v1';
  matrix_id: string;
  snapshot_id: string;
  revision: string;
  created_at: string;
  synthetic: boolean;
  anchor_symbol: string;
  playbook_id: string;
  definition_revision: string;
  period: string;
  period_type: 'year' | 'quarter';
  entities: { entity_id: string; symbol: string; name: string; sector: string | null }[];
  dimensions: MatrixDimension[];
  cells: MatrixCell[];
  limitations: string[];
}

export interface MatrixEvidence {
  evidence_id: string;
  entity_id: string;
  source: string;
  locator: string;
  field: string;
  value: string | null;
  unit: string;
  period: string;
  as_of: string | null;
  captured_at: string;
  provenance: 'stored_observation' | 'derived';
  formula: string | null;
  input_evidence_ids: string[];
  limitations: string[];
}

export interface MatrixSelection { snapshot_id: string; result_ids: string[] }
export interface MatrixResearchRequest extends MatrixSelection {
  revision: string;
  entity_ids: string[];
  dimension_ids: string[];
  period: string;
  source_scope: string[];
  request_text: string;
  snapshot: MatrixSnapshot;
  evidence: MatrixEvidence[];
}
export interface MatrixPlaybook {
  playbook_id: string;
  label: string;
  description: string;
  definition_revision: string;
  dimensions: MatrixDimension[];
}
export interface MatrixPreparation {
  anchor_symbol: string;
  playbook_id: string;
  symbols: string[];
  peer_basis: string;
  periods: string[];
  period_type: 'year';
  limitations: string[];
}
export interface MatrixCreate {
  anchor_symbol: string;
  symbols: string[];
  playbook_id: string;
  period: string;
  period_type: 'year' | 'quarter';
  matrix_id?: string;
}
export interface MatrixView {
  density: MatrixDensity;
  filter: string;
  sort: 'symbol' | 'reverse';
  pinned: string[];
  widths: Record<string, number>;
  hiddenDimensions: string[];
  snapshotRefs: string[];
}
