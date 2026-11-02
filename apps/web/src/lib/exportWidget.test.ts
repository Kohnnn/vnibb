import { provenanceToMarkdown, rowsToCSV } from './exportWidget';
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
