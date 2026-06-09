import html2canvas from 'html2canvas';
import { logClientError } from '@/lib/clientLogger';

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
  updatedAt?: number | string | Date | null;
  adjustmentMode?: string;
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
    ['Source', provenance.sourceLabel],
    ['API group', provenance.apiGroup],
    ['Endpoint', provenance.endpoint],
    ['Data updated', provenance.updatedAt ? normalizeTimestamp(provenance.updatedAt) : null],
    ['Adjustment mode', provenance.adjustmentMode],
    [
      'Freshness',
      provenance.localOnly
        ? 'local-only'
        : provenance.stale
          ? 'stale'
          : provenance.cached
            ? 'cached'
            : provenance.updatedAt
              ? 'live'
              : null,
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
  
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(','),
    ...rows.map(row => 
      headers.map(h => {
        const val = row[h];
        // Escape commas and quotes
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val ?? '';
      }).join(',')
    )
  ];

  const prefixLines: string[] = [];
  if (provenance) {
    const resolved = buildExportProvenance(provenance);
    const provRows: Array<[string, unknown]> = [
      ['widget', resolved.widgetTitle || resolved.widgetType],
      ['symbol', resolved.symbol],
      ['source', resolved.sourceLabel],
      ['api_group', resolved.apiGroup],
      ['endpoint', resolved.endpoint],
      ['data_updated', resolved.updatedAt],
      ['adjustment_mode', resolved.adjustmentMode],
      ['freshness', resolved.localOnly ? 'local-only' : resolved.stale ? 'stale' : resolved.cached ? 'cached' : resolved.updatedAt ? 'live' : undefined],
      ['captured_at', resolved.capturedAt],
    ];
    for (const [key, value] of provRows) {
      if (value !== undefined && value !== null && value !== '') {
        prefixLines.push(`# ${key},${String(value).replace(/[\r\n]+/g, ' ')}`);
      }
    }
  }

  const body = prefixLines.length ? `${prefixLines.join('\n')}\n${csvRows.join('\n')}` : csvRows.join('\n');
  const blob = new Blob([body], { type: 'text/csv' });
  downloadBlob(blob, `${filename}.csv`);
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
 * Export widget as PNG image
 */
export async function exportToPNG(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    logClientError(`Element with id "${elementId}" not found`);
    return;
  }
  
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#0a0a0a', // Match theme background
      useCORS: true,
    } as any);
    
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
