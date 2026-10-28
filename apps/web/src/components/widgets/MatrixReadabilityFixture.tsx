import { MatrixResult } from './matrix/MatrixResult';
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

export default function ReadabilityFixture() {
  const density = 'expanded';
  return (
    <div style={{ padding: 16 }}>
      <h1>Matrix readability fixture — 10 companies × 5 dimensions, density={density}</h1>
      <table aria-label="Company research Matrix" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: 120, border: '1px solid #ccc' }}>Company</th>
            {DIMENSIONS.map((d) => (
              <th key={d.dimension_id} scope="col" style={{ minWidth: 240, width: 240, border: '1px solid #ccc' }}>
                {d.label} <small>{d.output_type}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPANIES.map((symbol) => (
            <tr key={symbol}>
              <td style={{ border: '1px solid #ccc', fontWeight: 'bold' }}>{symbol}</td>
              {DIMENSIONS.map((dim) => (
                <td key={dim.dimension_id} style={{ border: '1px solid #ccc', verticalAlign: 'top' }}>
                  <MatrixResult cell={makeCell(symbol, dim)} density={density} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}