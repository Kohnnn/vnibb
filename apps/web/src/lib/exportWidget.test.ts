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
  afterEach(() => jest.resetModules());

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

    document.documentElement.style.setProperty('--color-bg-primary', '#ffffff');
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

      // html2canvas 1.4.1 reads `backgroundColor`; `background` is silently ignored.
      expect(options[0].backgroundColor).toBe('rgb(255, 255, 255)');
      // The strip is added below the capture, so the widget's own layout is untouched.
      expect(stampedHeight).toBeGreaterThan(200);
      expect(drawn.join(' ')).toContain('source: Market heatmap');
      expect(drawn.join(' ')).toContain('source_as_of: 2026-11-03T00:00:00.000Z');
      expect(drawn.join(' ')).toContain('fetched_at:');
      expect(drawn.join(' ')).not.toContain('1762000000000');
    } finally {
      jest.restoreAllMocks();
      host.remove();
      document.documentElement.style.removeProperty('--color-bg-primary');
    }
  });

  it('keeps a dark widget surface behind the provenance strip', async () => {
    const fills: string[] = [];
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: () => Promise.resolve({ width: 320, height: 200 }),
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

    const host = document.createElement('div');
    // Dark surface: the strip must not become a white band under the capture.
    host.style.backgroundColor = 'rgb(11, 17, 32)';
    const widget = document.createElement('div');
    widget.id = 'png-dark-widget';
    host.appendChild(widget);
    document.body.appendChild(host);

    try {
      const { exportToPNG } = await import('./exportWidget');
      await exportToPNG('png-dark-widget', 'dark', { sourceLabel: 'Dark heatmap' });
      expect(fills[0]).toBe('rgb(11, 17, 32)');
    } finally {
      jest.restoreAllMocks();
      host.remove();
    }
  });

  it('breaks an overwide provenance token inside a narrow widget', async () => {
    const drawn: string[] = [];
    jest.resetModules();
    jest.doMock('html2canvas', () => ({
      __esModule: true,
      default: () => Promise.resolve({ width: 140, height: 120 }),
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
