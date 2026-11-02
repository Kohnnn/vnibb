import html2canvas from 'html2canvas';
import { logClientError } from '@/lib/clientLogger';
import { deriveWidgetHealth } from '@/lib/widgetHealth';

/**
 * Source-aware export provenance. Phase 1 (Fincept/Quantcept-inspired) standard:
 * every export should carry where the data came from, which API group produced
 * it, when it was captured, and the adjustment mode where relevant, so exported
 * artifacts remain trustworthy and auditable.
 */
export interface ExportProvenance {
  widgetType?: string;
  widgetTitle?: string;
  symbol?: string;
  sourceLabel?: string;
  apiGroup?: string;
  endpoint?: string;
  cached?: boolean;
  stale?: boolean;
  warnings?: string[];
  /** Source observation/as-of only; retrieval belongs in fetchedAt. */
  updatedAt?: number | string | Date | null;
  fetchedAt?: number | string | Date | null;
  coverage?: 'complete' | 'partial' | 'unknown';
  marketClosed?: boolean;
  adjustmentMode?: string;
  /** Reporting period the figures belong to (e.g. 'FY', 'Q2', 'TTM'). */
  period?: string;
  localOnly?: boolean;
  capturedAt?: string;
  appVersion?: string;
}

function normalizeTimestamp(value?: number | string | Date | null): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Build a provenance footer object, filling capturedAt automatically.
 */
export function buildExportProvenance(input: ExportProvenance): ExportProvenance {
  return {
    ...input,
    updatedAt: normalizeTimestamp(input.updatedAt),
    fetchedAt: normalizeTimestamp(input.fetchedAt),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

/**
 * Render provenance as markdown lines (used by both markdown export and the
 * research notebook). Returns an empty string when nothing meaningful is set.
 */
export function provenanceToMarkdown(provenance?: ExportProvenance): string {
  if (!provenance) return '';
  const rows: Array<[string, unknown]> = [
    ['Widget', provenance.widgetTitle || provenance.widgetType],
    ['Symbol', provenance.symbol],
    ['Period', provenance.period],
    ['Source', provenance.sourceLabel],
    ['API group', provenance.apiGroup],
    ['Endpoint', provenance.endpoint],
    ['Source as of', normalizeTimestamp(provenance.updatedAt) ?? 'unknown'],
    ['Fetched at', normalizeTimestamp(provenance.fetchedAt)],
    ['Coverage', provenance.coverage],
    ['Delivery', provenance.cached === undefined ? null : provenance.cached ? 'cached snapshot' : 'not marked cached'],
    ['Adjustment mode', provenance.adjustmentMode],
    ['Warnings', provenance.warnings?.join(' · ') || null],
    [
      'Data status',
      deriveWidgetHealth(provenance)?.label ?? null,
    ],
    ['Captured at', provenance.capturedAt ?? new Date().toISOString()],
  ];
  const lines = rows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `- ${key}: ${value}`);
  if (!lines.length) return '';
  return `## Source & provenance\n\n${lines.join('\n')}\n`;
}

/**
 * Export data to CSV file. When provenance is supplied, a commented header block
 * is prepended so the CSV remains self-describing.
 */
function serializeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safeValue = typeof value === 'string' && /^\s*[=+\-@]/.test(serialized) ? `'${serialized}` : serialized;
  if (/[",\r\n]/.test(safeValue)) return `"${safeValue.replace(/"/g, '""')}"`;
  return safeValue;
}

export function rowsToCSV(rows: Array<Record<string, unknown>>): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [
    headers.map(serializeCSVCell).join(','),
    ...rows.map((row) => headers.map((header) => serializeCSVCell(row[header])).join(',')),
  ].join('\n');
}

/**
 * Provenance as ordered key/value pairs, shared by the CSV header block and the
 * Excel metadata sheet so both formats describe the data the same way.
 */
function provenanceLines(provenance?: ExportProvenance): Array<[string, string]> {
  if (!provenance) return [];
  const resolved = buildExportProvenance(provenance);
  const provRows: Array<[string, unknown]> = [
    ['widget', resolved.widgetTitle || resolved.widgetType],
    ['symbol', resolved.symbol],
    ['period', resolved.period],
    ['source', resolved.sourceLabel],
    ['api_group', resolved.apiGroup],
    ['endpoint', resolved.endpoint],
    ['source_as_of', resolved.updatedAt ?? 'unknown'],
    ['fetched_at', resolved.fetchedAt],
    ['coverage', resolved.coverage],
    ['cached', resolved.cached],
    ['adjustment_mode', resolved.adjustmentMode],
    ['warnings', resolved.warnings?.join(' · ') || undefined],
    ['data_status', deriveWidgetHealth(resolved)?.label],
    ['captured_at', resolved.capturedAt],
  ];
  return provRows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value).replace(/[\r\n]+/g, ' ')]);
}

export function exportToCSV(data: any, filename: string, provenance?: ExportProvenance) {
  let rows: any[] = [];
  
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === 'object') {
    // Handle single object or nested data
    const possibleData = data.data || data.records || data.results;
    if (Array.isArray(possibleData)) {
      rows = possibleData;
    } else {
      rows = [data];
    }
  }

  if (!rows.length) return;
  
  const csv = rowsToCSV(rows);
  // Provenance is data too: a warning or source label can contain commas or a
  // formula, so every value goes through the same guard and quoting as rows.
  const prefixLines = provenanceLines(provenance).map(([key, value]) => `# ${key},${serializeCSVCell(value)}`);

  const body = prefixLines.length ? `${prefixLines.join('\n')}\n${csv}` : csv;
  const blob = new Blob([body], { type: 'text/csv' });
  downloadBlob(blob, `${filename}.csv`);
}

/**
 * Export data to a real `.xlsx` workbook (SpreadsheetML, no extra dependency).
 *
 * Sheet "Data" holds the rows with the same columns as the CSV path; sheet
 * "Metadata" holds the provenance pairs. Cell type follows the original JS
 * value: finite numbers stay numeric, everything else is text with the CSV
 * formula guard, so `-5.3` is a number and `"007"` stays text.
 */
export function exportToXLSX(data: any, filename: string, provenance?: ExportProvenance) {
  const rows: Array<Record<string, unknown>> = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? Array.isArray(data.data || data.records || data.results)
        ? data.data || data.records || data.results
        : [data]
      : [];

  if (!rows.length) return;

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const meta: Array<[string, string]> = [['field', 'value'], ...provenanceLines(provenance)];

  const sheet = (name: string, table: unknown[][]) =>
    `<Worksheet ss:Name="${escapeXml(name)}"><Table>` +
    table
      .map(
        (cells) =>
          `<Row>${cells
            .map((cell) => {
              if (typeof cell === 'number' && Number.isFinite(cell)) {
                return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
              }
              const text = cell === null || cell === undefined
                ? ''
                : typeof cell === 'object'
                  ? JSON.stringify(cell)
                  : String(cell);
              return `<Cell><Data ss:Type="String">${escapeXml(guardFormula(text))}</Data></Cell>`;
            })
            .join('')}</Row>`,
      )
      .join('') +
    '</Table></Worksheet>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    sheet('Data', [headers, ...rows.map((row) => headers.map((header) => row[header]))]) +
    sheet('Metadata', meta) +
    '</Workbook>';

  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `${filename}.xls`);
}

/** Text cells keep their type; only formula-like text gets the CSV guard. */
function guardFormula(text: string): string {
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Export data to JSON file. When provenance is supplied it is attached under a
 * `_provenance` key so the exported artifact is self-describing.
 */
export function exportToJSON(data: any, filename: string, provenance?: ExportProvenance) {
  const payload = provenance
    ? { _provenance: buildExportProvenance(provenance), data }
    : data;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${filename}.json`);
}

/**
 * Export a markdown document. `body` is the main content; provenance is appended
 * as a "Source & provenance" section so exports remain trustworthy.
 */
export function exportToMarkdown(body: string, filename: string, provenance?: ExportProvenance) {
  const footer = provenanceToMarkdown(provenance);
  const doc = footer ? `${body.trimEnd()}\n\n${footer}` : body;
  const blob = new Blob([doc], { type: 'text/markdown' });
  downloadBlob(blob, `${filename}.md`);
}

/**
 * Resolve the surface a capture must paint behind itself. Widget bodies paint
 * their own background on an ancestor, so a transparent canvas would render a
 * dark image of a light page (and vice versa).
 */
function resolveSurfaceColor(element: HTMLElement): string | undefined {
  let node: HTMLElement | null = element;
  while (node) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
    node = node.parentElement;
  }
  const themed = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim();
  return themed || undefined;
}

/** The provenance facts a bitmap can carry without a sidecar file. */
function provenanceFooterText(provenance?: ExportProvenance): string {
  const wanted = ['source', 'source_as_of', 'fetched_at', 'captured_at'];
  return provenanceLines(provenance)
    .filter(([key]) => wanted.includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join('  ·  ');
}

/**
 * Export a widget as a PNG. `target` is a widget id or the element itself.
 * Provenance is painted into the image, because a bitmap cannot carry a
 * `_provenance` key.
 */
export async function exportToPNG(target: string | HTMLElement, filename: string, provenance?: ExportProvenance) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) {
    logClientError(`Element with id "${String(target)}" not found`);
    return;
  }

  const footerText = provenanceFooterText(provenance);
  try {
   const canvas = await html2canvas(element, {
     background: resolveSurfaceColor(element),
     useCORS: true,
     onclone: footerText
       ? (doc: Document, cloned: HTMLElement) => {
           const footer = doc.createElement('div');
           footer.textContent = footerText;
           footer.setAttribute('data-export-provenance', '');
           footer.style.cssText =
             'position:absolute;left:0;right:0;bottom:0;padding:3px 8px;text-align:right;' +
             'font:10px/1.4 ui-monospace,monospace;color:#94a3b8;background:transparent;';
           if (doc.defaultView?.getComputedStyle(cloned).position === 'static') {
             cloned.style.position = 'relative';
           }
           cloned.appendChild(footer);
         }
       : undefined,
   } as Parameters<typeof html2canvas>[1]);

    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${filename}.png`);
    }, 'image/png');
  } catch (error) {
    logClientError('Failed to export as PNG:', error);
  }
}

/**
 * Helper to trigger file download
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
