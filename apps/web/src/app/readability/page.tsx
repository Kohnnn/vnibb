'use client';

import { useState, useLayoutEffect, useEffect } from 'react';
import { MatrixResult } from '@/components/widgets/matrix/MatrixResult';
import type { MatrixCell, MatrixDimension } from '@/types/matrix';

const COMPANIES = ['FPT', 'VCB', 'BID', 'CTG', 'TPH', 'HDB', 'VPB', 'MBB', 'STB', 'TCH'];

const DIMENSIONS: MatrixDimension[] = [
  { dimension_id: 'profit', label: 'Profit quality', question: 'Is profit supported?', output_type: 'table', source_scope: 'Stored statements', definition_revision: 'definition-1' },
  { dimension_id: 'balance', label: 'Balance strength', question: 'Is the balance sheet resilient?', output_type: 'table', source_scope: 'Stored statements', definition_revision: 'definition-1' },
  { dimension_id: 'cashflow', label: 'Cash generation', question: 'Is cash flow real?', output_type: 'table', source_scope: 'Stored statements', definition_revision: 'definition-1' },
  { dimension_id: 'valuation', label: 'Valuation', question: 'Is the price supported by fundamentals?', output_type: 'number', source_scope: 'Stored prices', definition_revision: 'definition-1' },
  { dimension_id: 'research', label: 'Research note', question: 'What does the note say?', output_type: 'text', source_scope: 'Analyst coverage', definition_revision: 'definition-1' },
];

function makeCell(symbol: string, dim: MatrixDimension): MatrixCell {
  const value = 9_007_199_254_740_993.125;
  const metrics = [
    { key: 'revenue', label: 'Revenue', value: String(value), display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] },
    { key: 'gross_profit', label: 'Gross profit', value: String(value), display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] },
    { key: 'net_income', label: 'Net income', value: String(value), display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] },
    { key: 'total_assets', label: 'Total assets', value: String(value), display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] },
    { key: 'equity', label: 'Equity', value: String(value), display: '9,007,199,254,740,993.125 VND', unit: 'VND', period: '2025', as_of: null, basis: 'Consolidated', evidence_ids: ['observation-1'] },
  ];
  const payload = dim.output_type === 'table'
    ? { kind: 'table' as const, metrics }
    : dim.output_type === 'number'
    ? { kind: 'number' as const, metrics: [metrics[0]] }
    : dim.output_type === 'text'
    ? { kind: 'text' as const, text: `Synthetic research note for ${symbol} on ${dim.label}. This is not investment evidence and should never be treated as such. It is intentionally long so that wrapping and truncation behaviour at expanded density can be observed in a real viewport.` }
    : { kind: 'classification' as const, labels: ['Synthetic', 'Nonfinancial demonstration'] };
  return {
    result_id: `result-${symbol}-${dim.dimension_id}`,
    entity_id: symbol,
    dimension_id: dim.dimension_id,
    result_revision: 'revision-1',
    state: 'supported',
    payload,
    evidence_ids: ['observation-1'],
    basis: 'Consolidated',
    limitations: [],
    review_state: 'unreviewed',
  };
}

export default function ReadabilityPage() {
  const [density, setDensity] = useState<'compact' | 'standard' | 'expanded'>('expanded');
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [isMaximized, setIsMaximized] = useState(true);

  useEffect(() => {
    const next: Record<string, number> = {};
    DIMENSIONS.forEach((dim) => {
      next[`w_${dim.dimension_id}`] = isMaximized ? 640 : 240;
    });
    setWidths(next);
  }, [isMaximized]);

  return (
    <div className="readability-page">
      <h1>Matrix readability fixture — 10 companies × 5 dimensions, density={density}, maximized={isMaximized}</h1>
      <div className="matrix-toolbar">
        <label>Density: 
          <select value={density} onChange={(e) => setDensity(e.target.value as 'compact' | 'standard' | 'expanded')}>
            <option value="compact">Compact</option>
            <option value="standard">Standard</option>
            <option value="expanded">Expanded</option>
          </select>
        </label>
        <label>Maximize: 
          <button onClick={() => setIsMaximized(!isMaximized)}>
            {isMaximized ? 'Restore' : 'Maximize'}
          </button>
        </label>
      </div>
      <div className="matrix-grid">
        <div className="matrix-company" style={{ width: '120px', border: '1px solid #ccc', padding: 8 }}>
          <strong>Company</strong>
        </div>
        {DIMENSIONS.map((dim) => (
          <div key={dim.dimension_id} style={{ 
            border: '1px solid #ccc', 
            padding: 6, 
            minHeight: '95px',
            width: widths[`w_${dim.dimension_id}`] ?? 240,
            position: 'relative'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{dim.label} <small>{dim.output_type}</small></div>
            <MatrixResult cell={makeCell(COMPANIES[0], dim)} density={density} />
          </div>
        ))}
      </div>
    </div>
  );
}