import { exportToJSON, provenanceToMarkdown, rowsToCSV } from './exportWidget';
import { buildWidgetRuntime, getWidgetExportData } from './widgetRuntime';

describe('getWidgetExportData', () => {
  it('prefers runtime rows over widget metadata', () => {
    const rows = [{ symbol: 'FPT', net_volume: 100 }];

    expect(getWidgetExportData({
      metric: 'net_volume',
      __widgetRuntime: { exportData: rows },
    })).toEqual(rows);
  });
});

describe('historical warnings provenance', () => {
  it('preserves warnings through the shared runtime and readable export metadata', () => {
    const warnings = ['Partial historical coverage', 'Historical price units unconfirmed'];
    const payload = buildWidgetRuntime({
      empty: false,
      apiGroup: '/equity',
      endpoint: '/equity/historical?symbol=FPT',
      lastDataDate: '2024-02-09',
      warnings,
    });

    expect(payload).toEqual(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({
        provenance: expect.objectContaining({ updatedAt: '2024-02-09', warnings }),
      }),
    }));
    expect(provenanceToMarkdown({ warnings, capturedAt: '2026-10-05T10:00:00Z' }))
      .toContain('- Warnings: Partial historical coverage · Historical price units unconfirmed');
  });
});

describe('source and retrieval provenance', () => {
  it('keeps old source data stale in exported metadata after a new fetch', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-08T03:00:00Z').getTime());
    try {
      const markdown = provenanceToMarkdown({
        updatedAt: '2026-09-21T15:00:00Z', fetchedAt: '2026-10-08T03:00:00Z',
        cached: true, coverage: 'partial', capturedAt: '2026-10-08T03:00:00Z',
      });
      expect(markdown).toContain('- Source as of: 2026-09-21T15:00:00.000Z');
      expect(markdown).toContain('- Fetched at: 2026-10-08T03:00:00.000Z');
      expect(markdown).toContain('- Coverage: partial');
      expect(markdown).toContain('- Data status: Stale');
    } finally {
      now.mockRestore();
    }
  });
});

describe('rowsToCSV', () => {
  it('keeps the first-seen union of fields across every row', () => {
    expect(rowsToCSV([
      { symbol: 'FPT', price: 100 },
      { symbol: 'VNM', volume: 200 },
    ])).toBe('symbol,price,volume\nFPT,100,\nVNM,,200');
  });

  it('JSON serializes structured cells before CSV escaping', () => {
    expect(rowsToCSV([
      { symbol: 'FPT', tags: ['bank', 'large'], meta: { source: 'api' } },
    ])).toBe('symbol,tags,meta\nFPT,"[""bank"",""large""]","{""source"":""api""}"');
  });

  it('neutralizes formula-like string cells without changing negative numbers', () => {
    expect(rowsToCSV([
      { symbol: '=CMD()', note: ' +SUM(A1:A2)', change: -2 },
    ])).toBe("symbol,note,change\n'=CMD(),' +SUM(A1:A2),-2");
  });
});

describe('exportToXLSX', () => {
  it('writes a spreadsheet with the data columns and a distinct metadata sheet', async () => {
    const captured: Array<{ blob: Blob; filename: string }> = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push({ blob, filename: '' });
      return 'blob:test';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured[captured.length - 1].filename = this.download;
    });

    try {
      const { exportToXLSX } = await import('./exportWidget');
      exportToXLSX(
        [{ symbol: 'FPT', period: 'FY2027F', revenue: 63000, note: '=CMD()', change: -5.3, zero: 0, code: '007', digits: '1234' }],
        'fpt_fy2027f',
        {
          widgetType: 'income_statement',
          symbol: 'FPT',
          sourceLabel: 'VniBB financials API',
          fetchedAt: '2026-11-02T03:00:00Z',
        },
      );

      const { blob, filename } = captured[0];
      const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      expect(filename).toBe('fpt_fy2027f.xls');
      expect(blob.type).toBe('application/vnd.ms-excel');
      expect(text).toContain('ss:Name="Data"');
      expect(text).toContain('ss:Name="Metadata"');
      expect(text).toContain('>symbol<');
      expect(text).toContain('>FY2027F<');
      expect(text).toContain('ss:Type="Number">63000<');
      expect(text).toContain('ss:Type="Number">-5.3<');
      expect(text).toContain('ss:Type="Number">0<');
      expect(text).toContain('ss:Type="String">007<');
      expect(text).toContain('ss:Type="String">1234<');
      expect(text).toContain('ss:Type="String">\'=CMD()<');
      expect(text).toContain('>source_as_of<');
      expect(text).toContain('>fetched_at<');
      expect(text).toContain('2026-11-02T03:00:00.000Z');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('exportToJSON', () => {
  it('wraps rows with _provenance and keeps source time distinct from fetch time', async () => {
    const captured: Array<{ blob: Blob; filename: string }> = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push({ blob, filename: '' });
      return 'blob:test';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured[captured.length - 1].filename = this.download;
    });

    try {
      exportToJSON(
        [{ symbol: 'FPT', revenue: 63000 }],
        'fpt',
        { symbol: 'FPT', sourceLabel: 'VniBB financials API', fetchedAt: '2026-11-02T03:00:00Z' },
      );

      const { blob, filename } = captured[0];
      const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      const payload = JSON.parse(text);
      expect(filename).toBe('fpt.json');
      expect(payload.data).toEqual([{ symbol: 'FPT', revenue: 63000 }]);
      expect(payload._provenance.fetchedAt).toBe('2026-11-02T03:00:00.000Z');
      expect(payload._provenance.updatedAt).toBeNull();
      expect(payload._provenance.capturedAt).toBeTruthy();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('exportToCSV provenance', () => {
  it('guards and quotes provenance values like any other cell', async () => {
    const captured: Array<{ blob: Blob; filename: string }> = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push({ blob, filename: '' });
      return 'blob:test';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured[captured.length - 1].filename = this.download;
    });

    try {
      const { exportToCSV } = await import('./exportWidget');
      exportToCSV([{ symbol: 'FPT', revenue: 63000 }], 'fpt', {
        sourceLabel: 'VniBB API, financials',
        warnings: ['=HYPERLINK("http://evil")'],
      });

      const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(captured[0].blob); });
      expect(text).toContain('# source,"VniBB API, financials"');
      expect(text).toContain('# warnings,"\'=HYPERLINK(""http://evil"")"');
      expect(text).toContain('symbol,revenue\nFPT,63000');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('exportToPNG', () => {
  // jsdom has no encoder; every capture path ends in `toBlob`.
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });


  it('paints the surrounding surface and stamps source + both timestamps into the image', async () => {
    const options: Array<Record<string, unknown>> = [];
    const drawn: string[] = [];
    let stampedHeight = 0;
    // Dynamic import is required: the module graph must be rebuilt so the html2canvas
    // mock below replaces the static import resolved at the top of this file.
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: (_element: HTMLElement, opts: Record<string, unknown>) => {
        options.push(opts);
        return Promise.resolve({ width: 320, height: 200, toBlob: (cb: (b: null) => void) => cb(null) });
      },
    }));
    const context = {
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      fillText: (text: string) => drawn.push(text),
      measureText: (text: string) => ({ width: text.length * 6 }),
      set fillStyle(_v: string) {},
      set font(_v: string) {},
      get font() { return '10px ui-monospace, monospace'; },
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    };
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      // jsdom has no 2D context; stub just the members stampFooter touches.
      if (tag === 'canvas') {
        // jsdom ships no 2D context; stampFooter only touches these members.
        Object.assign(el, { getContext: () => context });
        Object.defineProperty(el, 'height', {
          configurable: true,
          get: () => stampedHeight,
          set: (v: number) => { stampedHeight = v; },
        });
      }
      return el;
    }) as typeof document.createElement);
    document.documentElement.style.setProperty('--bg-primary', '#ffffff');
    document.documentElement.setAttribute('data-theme', 'dark');
    const host = document.createElement('div');
    host.style.backgroundColor = 'rgb(255, 255, 255)';
    const widget = document.createElement('div');
    widget.id = 'png-widget';
    host.appendChild(widget);
    document.body.appendChild(host);

    try {
      const { exportToPNG } = await import('./exportWidget');
      await exportToPNG('png-widget', 'heatmap', {
        sourceLabel: 'Market heatmap',
        updatedAt: '2026-11-03',
        fetchedAt: 1762000000000,
      });
      // Brand §14: exports are light. html2canvas 1.4.1 reads `backgroundColor`;
      // `background` is silently ignored.
      expect(options[0].backgroundColor).toBe('#ffffff');
      // The strip is added below the capture, so the widget's own layout is untouched.
      expect(stampedHeight).toBeGreaterThan(200);
      expect(drawn.join(' ')).toContain('source: Market heatmap');
      expect(drawn.join(' ')).toContain('source_as_of: 2026-11-03T00:00:00.000Z');
      expect(drawn.join(' ')).toContain('fetched_at:');
      expect(drawn.join(' ')).not.toContain('1762000000000');
    } finally {
      jest.restoreAllMocks();
      host.remove();
      document.documentElement.style.removeProperty('--bg-primary');
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('exports the light surface and leaves a dark user theme untouched', async () => {
    const fills: string[] = [];
    const captured: Array<Record<string, unknown>> = [];
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: (_element: HTMLElement, opts: Record<string, unknown>) => {
        captured.push(opts);
        return Promise.resolve({
          width: 320,
          height: 200,
          toBlob: (cb: (blob: Blob) => void) => cb(new Blob(['png'], { type: 'image/png' })),
        });
      },
    }));
    const context = {
      fillRect: () => fills.push(context.fillStyle),
      drawImage: jest.fn(),
      fillText: jest.fn(),
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
    };
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') Object.assign(el, { getContext: () => context });
      return el;
    }) as typeof document.createElement);

    const root = document.documentElement;
    root.style.setProperty('--bg-primary', '#ffffff');
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');
    const host = document.createElement('div');
    // The widget sits on a dark dashboard; the export is light regardless.
    host.style.backgroundColor = 'rgb(11, 17, 32)';
    const widget = document.createElement('div');
    widget.id = 'png-dark-widget';
    host.appendChild(widget);
    document.body.appendChild(host);

    try {
      const { exportToPNG } = await import('./exportWidget');
      await exportToPNG('png-dark-widget', 'dark', { sourceLabel: 'Dark heatmap' });
      expect(captured[0].backgroundColor).toBe('#ffffff');
      // The strip continues the same light surface instead of a dark band.
      expect(fills[0]).toBe('#ffffff');
      // No user preference was changed by exporting.
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.classList.contains('light')).toBe(false);
    } finally {
      jest.restoreAllMocks();
      host.remove();
      root.style.removeProperty('--bg-primary');
      root.removeAttribute('data-theme');
      root.classList.remove('dark');
    }
  });

  it('breaks an overwide provenance token inside a narrow widget', async () => {
    const drawn: string[] = [];
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: () => Promise.resolve({
        width: 140,
        height: 120,
        toBlob: (cb: (blob: Blob) => void) => cb(new Blob(['png'], { type: 'image/png' })),
      }),
    }));
    const context = {
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      fillText: (text: string) => drawn.push(text),
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
    };
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') Object.assign(el, { getContext: () => context });
      return el;
    }) as typeof document.createElement);

    const widget = document.createElement('div');
    widget.id = 'png-narrow-widget';
    widget.style.width = '140px';
    document.body.appendChild(widget);

    try {
      const { exportToPNG } = await import('./exportWidget');
      await exportToPNG('png-narrow-widget', 'narrow', {
        sourceLabel: 'Narrow heatmap',
        updatedAt: '2026-11-03T00:00:00.000Z',
      });
      // 140px strip minus 16px inset leaves 124px = ~20 monospace characters.
      expect(drawn.length).toBeGreaterThan(1);
      for (const line of drawn) expect(line.length * 6).toBeLessThanOrEqual(124);
      expect(drawn.join('')).toContain('2026-11-03T00:00:00.000Z');
    } finally {
      jest.restoreAllMocks();
      widget.remove();
    }
  });

  it('hands html2canvas a clone whose modern colors were already rewritten', async () => {
    let capturedOptions: Record<string, any> = {};
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: (_element: HTMLElement, opts: Record<string, any>) => {
        capturedOptions = opts;
        return Promise.resolve({ width: 100, height: 100, toBlob: (cb: (b: null) => void) => cb(null) });
      },
    }));

    // The reference element html2canvas passes back is a *clone* in a fresh
    // document: reproduction of the real call, where `documentClone` differs
    // from the live `document` and the widget element has no id.
    const widget = document.createElement('div');
    widget.style.color = 'oklch(0.901 0.058 230.902)';
    widget.style.borderTopColor = 'color(srgb 0.231373 0.509804 0.964706 / 0.45)';
    document.body.appendChild(widget);

    const owner = document.defaultView as Window & typeof globalThis;
    // A detached clone root: html2canvas themes an iframe document, never the
    // live one, and `onclone` resolves the light palette from it.
    const cloneRoot = document.createElement('html');
    cloneRoot.style.setProperty('--bg-primary', '#ffffff');
    try {
      // Dynamic import is required: jest.resetModules() above rebuilds the
      // module graph so the html2canvas mock replaces the static import.
      const { exportToPNG } = await import('./exportWidget');
      await exportToPNG(widget, 'heatmap', { sourceLabel: 'Market heatmap' });

      const documentClone = {
        defaultView: owner,
        documentElement: cloneRoot,
        body: document.body,
      } as unknown as Document;
      // The widget is id-less, exactly like the market heatmap's ref target.
      capturedOptions.onclone(documentClone, widget);

      expect(widget.style.color).toBe('rgb(184, 230, 254)');
      expect(widget.style.borderTopColor).toMatch(/^rgba\(59, 130, 246, 0\.45\)$/);
      // Nothing unparseable may survive for html2canvas to throw on.
      expect(widget.style.cssText).not.toMatch(/oklch|oklab|color\(/);
    } finally {
      // The export never restyles the live root, so there is nothing to undo.
      expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('');
      jest.restoreAllMocks();
      widget.remove();
    }
  });


  it('replaces a chart canvas with the light bitmap the chart renders for export', async () => {
    jest.resetModules();
    const root = document.documentElement;
    root.style.setProperty('--bg-primary', '#ffffff');
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');

    // The chart host mirrors the real component: it answers the capture event
    // with a bitmap of its own light rendering.
    const widget = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('data-light-chart-capture', '');
    host.appendChild(document.createElement('canvas'));
    widget.appendChild(host);
    document.body.appendChild(widget);
    const drawn: string[] = [];
    host.addEventListener('vnibb:capture-light-chart', (event) => {
      const detail = (event as CustomEvent<{ token: (name: string) => string; canvas?: HTMLCanvasElement }>).detail;
      drawn.push(detail.token('--bg-primary'));
      const bitmap = document.createElement('canvas');
      bitmap.width = 100;
      bitmap.height = 60;
      detail.canvas = bitmap;
    });

    let capturedOptions: Record<string, any> = {};
    const captured: { reference: HTMLElement | null } = { reference: null };
    let cloneThemes: Array<string | null> = [];
    let created = 0;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (() => { created += 1; return 'blob:test'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    // The mock reproduces html2canvas's contract: it hands back a light clone of
    // the page and drives `onclone`, which is where the chart capture happens.
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: (_element: HTMLElement, opts: Record<string, any>) => {
        capturedOptions = opts;
        // A detached clone root: the real `documentClone` belongs to the
        // html2canvas iframe, so writing to it must not reach the live document.
        const cloneRoot = document.createElement('html');
        cloneRoot.style.setProperty('--bg-primary', '#ffffff');
        cloneRoot.style.setProperty('--text-muted', '#5b6573');
        const documentClone = {
          defaultView: document.defaultView,
          documentElement: cloneRoot,
          body: document.body,
        } as unknown as Document;
        captured.reference = widget.cloneNode(true) as HTMLElement;
        opts.onclone(documentClone, captured.reference);
        // html2canvas themes only its own clone document.
        cloneThemes = [
          documentClone.documentElement.getAttribute('data-theme'),
          documentClone.documentElement.classList.contains('light') ? 'light' : null,
        ];
        return Promise.resolve({
          width: 100,
          height: 60,
          toBlob: (cb: (blob: Blob) => void) => cb(new Blob(['png'], { type: 'image/png' })),
        });
      },
    }));

    try {
      // Dynamic import: the mock above must replace html2canvas before the
      // module under test resolves it.
      const { exportToPNG } = await import('./exportWidget');
      expect(await exportToPNG(widget, 'chart', { sourceLabel: 'Price chart' })).toBe(true);

      // The chart answered with a bitmap of its own light rendering.
      expect(drawn).toEqual(['#ffffff']);
      expect(capturedOptions.backgroundColor).toBe('#ffffff');
      const exported = captured.reference?.querySelector<HTMLElement>('[data-light-chart-capture]');
      expect(exported?.childElementCount).toBe(1);
      expect(exported?.firstElementChild?.tagName).toBe('CANVAS');
      // The live widget still owns its original canvas.
      expect(host.firstElementChild?.tagName).toBe('CANVAS');
      expect(host.childElementCount).toBe(1);
      // Only the clone was themed light; the user's theme survived.
      expect(cloneThemes).toEqual(['light', 'light']);
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.classList.contains('light')).toBe(false);
      expect(created).toBe(1);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      jest.restoreAllMocks();
      widget.remove();
      root.style.removeProperty('--bg-primary');
      root.removeAttribute('data-theme');
      root.classList.remove('dark');
    }
  });
});

describe('exportToCSV matrix export', () => {
  it('emits one row per correlation cell so counts never replace the matrix', async () => {
    const captured: Blob[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push(blob);
      return 'blob:test';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      const { exportToCSV } = await import('./exportWidget');
      exportToCSV([
        { x: 'VCI', y: 'VCI', value: 1 },
        { x: 'VCI', y: 'SSI', value: 0.7 },
      ], 'correlation_matrix_VCI', { symbol: 'VCI', period: '60D' });

      const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(captured[0]); });
      expect(text).toContain('# period,60D');
      expect(text).toContain('x,y,value\nVCI,VCI,1\nVCI,SSI,0.7');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('modern color downgrade', () => {
  // Chromium serializes Tailwind v4's palette and `color-mix()` output as
  // oklch()/oklab()/color(srgb …). html2canvas 1.4.1 parses only rgb/hsl and
  // threw `Attempting to parse an unsupported color function` before painting,
  // so every dashboard PNG export came back empty.
  const channelsOf = (css: string) => css.match(/-?[\d.]+/g)?.map(Number) ?? [];

  /** Chromium's own rasterizer is the oracle; its matrix differs by <=1 LSB. */
  const expectColor = (actual: string, expected: [number, number, number], alpha?: number) => {
    const [r, g, b, a] = channelsOf(actual);
    const [er, eg, eb] = expected;
    expect(Math.abs(r - er)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - eg)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - eb)).toBeLessThanOrEqual(1);
    expect(a ?? 1).toBeCloseTo(alpha ?? 1, 2);
  };

  it('converts oklch, oklab, and color(srgb) to rgb the parser accepts', async () => {
    const { rewriteColorSyntax } = await import('./exportWidget');
    // Expected RGB read back from Chromium's canvas rasterizer in the live app.
    expect(rewriteColorSyntax('oklch(0.901 0.058 230.902)')).toMatch(/^rgb\(/);
    expectColor(rewriteColorSyntax('oklch(0.901 0.058 230.902)'), [184, 230, 254]);
    expectColor(rewriteColorSyntax('oklab(0.623 -0.0378409 -0.210628)'), [43, 127, 255]);
    expectColor(rewriteColorSyntax('color(srgb 0.231373 0.509804 0.964706)'), [59, 130, 246]);
  });

  it('keeps the alpha channel as rgba', async () => {
    const { rewriteColorSyntax } = await import('./exportWidget');
    expectColor(rewriteColorSyntax('oklab(0.623 -0.0378409 -0.210628 / 0.3)'), [43, 127, 255], 0.3);
    expectColor(rewriteColorSyntax('oklch(0.5 0.1 200 / 45%)'), [0, 116, 122], 0.45);
    expect(rewriteColorSyntax('oklab(0.623 -0.0378409 -0.210628 / 1)')).toMatch(/^rgb\(/);
  });

  it('rewrites colors embedded in gradients and shadows, leaving others alone', async () => {
    const { rewriteColorSyntax } = await import('./exportWidget');
    expect(rewriteColorSyntax('linear-gradient(to right, oklch(0.901 0.058 230.902), rgb(1, 2, 3))'))
      .toMatch(/^linear-gradient\(to right, rgb\(184, 230, 254\), rgb\(1, 2, 3\)\)$/);
    expect(rewriteColorSyntax('oklab(0.6 -0.1 -0.2 / 0.4) 0px 1px 2px 0px'))
      .toMatch(/^rgba\(\d+, \d+, \d+, 0\.4\) 0px 1px 2px 0px$/);
    expect(rewriteColorSyntax('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(rewriteColorSyntax('10px solid rgba(0, 0, 0, 0)')).toBe('10px solid rgba(0, 0, 0, 0)');
  });

  it('leaves colorspaces it cannot convert untouched instead of emitting junk', async () => {
    const { rewriteColorSyntax } = await import('./exportWidget');
    expect(rewriteColorSyntax('color(display-p3 0.2 0.9 0.3)')).toBe('color(display-p3 0.2 0.9 0.3)');
    expect(rewriteColorSyntax('oklch(nonsense)')).toBe('oklch(nonsense)');
  });

  it('normalizes every computed color on the capture subtree', async () => {
    const { normalizeCaptureColors } = await import('./exportWidget');
    const host = document.createElement('div');
    // jsdom echoes authored inline styles back, so a rewrite is observable
    // without a layout engine.
    host.style.color = 'oklch(0.901 0.058 230.902)';
    host.style.borderTopColor = 'color(srgb 0.231373 0.509804 0.964706 / 0.45)';
    const child = document.createElement('span');
    child.style.backgroundColor = 'oklab(0.623 -0.0378409 -0.210628 / 0.3)';
    host.appendChild(child);
    document.body.appendChild(host);

    try {
      normalizeCaptureColors(host);
      expect(host.style.color).toMatch(/^rgb\(184, 230, 254\)$/);
      expect(host.style.borderTopColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);
      expect(child.style.backgroundColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
    } finally {
      host.remove();
    }
  });
});
