import html2canvas from 'html2canvas';
import { toast } from 'sonner';
import { logClientError } from '@/lib/clientLogger';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { LIGHT_CAPTURE_ATTR, prepareLightCapture } from '@/lib/chartCapture';

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

/** The provenance facts a bitmap can carry without a sidecar file. */
function provenanceFooterText(provenance?: ExportProvenance): string {
  const wanted = ['source', 'source_as_of', 'fetched_at', 'captured_at'];
  return provenanceLines(provenance)
    .filter(([key]) => wanted.includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join('  ·  ');
}

/**
 * Downgrade the modern color syntaxes Chromium reports from `getComputedStyle`
 * into the `rgb()`/`rgba()` forms html2canvas 1.4.1 can parse.
 *
 * Tailwind v4 declares its palette in `oklch()`, and `color-mix()` computes to
 * `oklab()` or `color(srgb …)`; Chromium serializes all three verbatim. The
 * parser only knows `rgb`/`hsl`, so it threw
 * `Attempting to parse an unsupported color function` and every dashboard
 * export produced nothing.
 *
 * Rewrites color functions anywhere in the value, so gradients and shadows
 * survive; anything it cannot convert is left untouched.
 *
 * ponytail: srgb colorspace only. Extend if a widget ever paints `display-p3`.
 */
export function rewriteColorSyntax(value: string): string {
  return value.replace(/\b(oklab|oklch|color)\(([^()]*)\)/gi, (token, fn: string, body: string) => {
    const channels = convertColorChannels(fn.toLowerCase(), body);
    if (!channels) return token;
    const alphaPart = body.split('/')[1]?.trim();
    const parsedAlpha = alphaPart
      ? Number.parseFloat(alphaPart) / (alphaPart.endsWith('%') ? 100 : 1)
      : 1;
    const alpha = Number.isFinite(parsedAlpha) ? Math.min(1, Math.max(0, parsedAlpha)) : 1;
    return alpha === 1
      ? `rgb(${channels.join(', ')})`
      : `rgba(${channels.join(', ')}, ${Number(alpha.toFixed(4))})`;
  });
}

/** Convert the channel body of `oklab()`/`oklch()`/`color()` to 0-255 sRGB. */
function convertColorChannels(fn: string, body: string): number[] | null {
  const parts = body.split('/')[0].trim().split(/\s+/);
  const ratio = (part: string) => {
    const num = Number.parseFloat(part);
    if (!Number.isFinite(num)) return Number.NaN;
    return part.endsWith('%') ? num / 100 : num;
  };
  const toByte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255);

  if (fn === 'color') {
    // `color(srgb 0.23 0.51 0.96)` is already gamma-encoded sRGB.
    if (parts.shift()?.toLowerCase() !== 'srgb' || parts.length < 3) return null;
    const channels = parts.slice(0, 3).map(ratio);
    return channels.some(Number.isNaN) ? null : channels.map(toByte);
  }

  const channels = parts.slice(0, 3).map(ratio);
  if (channels.some(Number.isNaN)) return null;
  const [l, c, third] = channels;
  const lightness = Math.min(1, Math.max(0, l));
  // oklch stores polar chroma + hue; oklab stores cartesian a/b.
  const hue = fn === 'oklch' ? (third * Math.PI) / 180 : 0;
  const a = fn === 'oklch' ? c * Math.cos(hue) : c;
  const b = fn === 'oklch' ? c * Math.sin(hue) : third;
  const l3 = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map((channel) => {
    const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return toByte(encoded);
  });
}

/**
 * Inline every unparseable color on the capture clone as `rgb()`/`rgba()` so
 * html2canvas can read it back. Runs on the clone, so the live widget keeps its
 * own styles.
 *
 * Walks the whole computed declaration rather than a property allowlist: a
 * single missed property aborts the export. Custom properties are skipped
 * because html2canvas never reads them.
 */
export function normalizeCaptureColors(root: HTMLElement, view?: Window | null) {
  const owner = view ?? root.ownerDocument.defaultView ?? window;
  const getStyle = owner.getComputedStyle.bind(owner);
  for (const node of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const computed = getStyle(node);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed[index];
      if (property.startsWith('--')) continue;
      const value = computed.getPropertyValue(property);
      const rewritten = rewriteColorSyntax(value);
      // `important`, because colourblind mode and the reduced-effects rules
      // declare colors `!important`; a plain inline value would lose to them
      // and html2canvas would parse the unparseable stylesheet value instead.
      if (rewritten !== value) node.style.setProperty(property, rewritten, 'important');
    }
  }
}

/**
 * Report a failed PNG export. A silent failure leaves the user with no file and
 * no explanation, so every abort path ends here.
 */
function reportExportFailure(error: unknown) {
  logClientError('Failed to export as PNG:', error);
  if (typeof window !== 'undefined') {
    toast.error('PNG export failed', {
      description: error instanceof Error ? error.message : 'The widget could not be captured.',
    });
  }
}

/**
 * Captures are serialized: html2canvas appends one offscreen iframe to the
 * shared document per capture and only removes it on success, so two
 * concurrent exports cannot tell each other's iframe from their own. Without a
 * queue, a failing export would delete the iframe a running one still paints
 * into. The queue also makes `clonesBefore` ownership unambiguous.
 */
let captureQueue: Promise<unknown> = Promise.resolve();

/**
 * Export a widget as a PNG. `target` is a widget id or the element itself.
 * Provenance is painted into the image, because a bitmap cannot carry a
 * `_provenance` key.
 *
 * Resolves `true` only after the download started. Every failure is surfaced to
 * the user (toast) and reported as `false`, never as a silent wrong image.
 */
export function exportToPNG(
  target: string | HTMLElement,
  filename: string,
  provenance?: ExportProvenance,
): Promise<boolean> {
  const run = captureQueue.then(() => captureWidgetAsPNG(target, filename, provenance));
  // A rejected link would poison every later export, so the queue never rejects.
  captureQueue = run.catch(() => {});
  return run;
}

async function captureWidgetAsPNG(
  target: string | HTMLElement,
  filename: string,
  provenance?: ExportProvenance,
): Promise<boolean> {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) {
    reportExportFailure(new Error(`Element with id "${String(target)}" not found`));
    return false;
  }

  const footerText = provenanceFooterText(provenance);
  // Set inside `onclone`, the first moment the light surface is known.
  let lightSurface = '#ffffff';
  // html2canvas appends an offscreen copy of the whole page and only removes it
  // on success, so a refused capture would leave one behind per attempt.
  const clonesBefore = new Set(document.querySelectorAll('iframe.html2canvas-container'));
  try {
    const canvas = await html2canvas(element, {
      // html2canvas reads this after `onclone`, so the getter sees the clone's
      // resolved light surface rather than a guessed default.
      get backgroundColor() {
        return lightSurface;
      },
      useCORS: true,
      // html2canvas hands us its clone and the cloned element, so this works
      // for ref-based widgets (the market heatmap) that have no id. Before
      // parsing that element it also reads `backgroundColor` off the clone's
      // `html`/`body` — the whole page, not just the widget — so those two
      // values need the same downgrade or the export dies before painting.
      onclone: (documentClone, reference) => {
        // The clone is themed light first, so the charts below read the light
        // palette from it. The live document keeps the user's theme throughout.
        documentClone.documentElement.classList.remove('dark');
        documentClone.documentElement.classList.add('light');
        documentClone.documentElement.setAttribute('data-theme', 'light');
        // Ask each live chart for its own light bitmap; it repaints, snapshots
        // and restores itself, so candles and axes stay the chart's real content.
        const plan = prepareLightCapture(element, documentClone.documentElement);
        const chartHosts = reference.querySelectorAll<HTMLElement>(`[${LIGHT_CAPTURE_ATTR}]`);
        // A count mismatch means a chart mounted or unmounted between planning
        // and cloning; abort rather than leave its dark canvas in the capture.
        if (chartHosts.length !== plan.bitmaps.length) {
          throw new Error('A chart could not be re-rendered for a light export');
        }
        chartHosts.forEach((host, index) => {
          const bitmap = plan.bitmaps[index];
          // The bitmap is already a canvas of the chart's own light rendering;
          // append it as-is so no second pixel copy (and no 2D context) is needed.
          bitmap.style.width = '100%';
          bitmap.style.height = '100%';
          host.replaceChildren(bitmap);
        });
        normalizeCaptureColors(reference, documentClone.defaultView);
        // html2canvas parses the clone's html/body background before painting,
        // so this value needs the same downgrade the cloned nodes just got;
        // a raw `oklch()` here would abort the capture.
        lightSurface = rewriteColorSyntax(plan.surface);
        for (const node of [documentClone.documentElement, documentClone.body]) {
          if (node) node.style.backgroundColor = lightSurface;
        }
      },
    });
    const output = footerText ? stampFooter(canvas, footerText, element.clientWidth, lightSurface) : canvas;
    // A canvas without `toBlob` (or a browser that never calls back) would leave
    // the export pending forever; refuse instead of hanging without feedback.
    if (typeof output.toBlob !== 'function') {
      throw new Error('The browser cannot encode a PNG from this capture');
    }
    const { promise, resolve, reject } = Promise.withResolvers<Blob>();
    output.toBlob((encodedBlob) => {
      // A null blob means the browser could not encode the capture; never
      // report success without a downloadable file.
      if (encodedBlob) resolve(encodedBlob);
      else reject(new Error('The browser could not encode the captured chart'));
    }, 'image/png');
    downloadBlob(await promise, `${filename}.png`);
    return true;
  } catch (error) {
    for (const clone of document.querySelectorAll('iframe.html2canvas-container')) {
      if (!clonesBefore.has(clone)) clone.remove();
    }
    reportExportFailure(error);
    return false;
  }
}

/**
 * Paint the provenance strip below the captured bitmap. Compositing instead of
 * injecting a DOM node keeps the widget's own layout untouched: a fixed-height
 * widget would otherwise clip, or be overdrawn by, the appended footer.
 */
function stampFooter(source: HTMLCanvasElement, text: string, cssWidth: number, surface?: string): HTMLCanvasElement {
  const scale = cssWidth > 0 ? source.width / cssWidth : 1;
  const pad = Math.round(4 * scale);
  const lineHeight = Math.round(15 * scale);
  const inset = Math.round(8 * scale);
  const probe = document.createElement('canvas').getContext('2d');
  // jsdom has no 2D context; return the untouched capture rather than crash.
  if (!probe) return source;

  probe.font = `${Math.round(10 * scale)}px ui-monospace, monospace`;
  const lines: string[] = [];
  const limit = source.width - inset * 2;
  // Wrap, never shrink: fillText's maxWidth squeezes glyphs past readability.
  // A single token can exceed the strip (ISO timestamps in a narrow widget), so
  // break it at measured character boundaries instead of letting it overflow.
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (probe.measureText(rest).width > limit) {
      let cut = rest.length - 1;
      while (cut > 1 && probe.measureText(rest.slice(0, cut)).width > limit) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const last = lines.length - 1;
    const joins = last >= 0 && probe.measureText(`${lines[last]} ${rest}`).width <= limit;
    if (joins) lines[last] += ` ${rest}`;
    else lines.push(rest);
  }

  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height + lines.length * lineHeight + pad * 2;
  const ctx = out.getContext('2d');
  if (!ctx) return source;

  // The export is light by design (brand §14), so the strip continues the light
  // surface with the light palette's Rule hairline and Slate text.
  ctx.fillStyle = surface ?? '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = '#d9dde3';
  ctx.fillRect(0, source.height, out.width, Math.max(1, Math.round(scale)));
  ctx.fillStyle = '#5b6573';
  ctx.font = probe.font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, out.width - inset, source.height + pad + lineHeight * (index + 0.5));
  });
  return out;
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
