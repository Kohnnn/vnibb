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
