import { fireEvent, render, screen } from '@testing-library/react';
import { ExportButton } from './ExportButton';

const captured: Array<{ text: string; filename: string; type: string }> = [];

beforeEach(() => {
  captured.length = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const entry = { text: '', filename: '', type: blob.type };
    captured.push(entry);
    const reader = new FileReader();
    reader.onload = () => { entry.text = String(reader.result); };
    reader.readAsText(blob);
    return 'blob:test';
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const entry = captured[captured.length - 1];
    if (entry) entry.filename = this.download;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const rows = [{ symbol: 'FPT', revenue: 63000 }];
const provenance = { symbol: 'FPT', sourceLabel: 'VniBB financials API', fetchedAt: '2026-11-02T03:00:00Z' };

async function exportAs(label: string) {
  render(<ExportButton data={rows} filename="fpt" formats={['csv', 'xlsx', 'json']} provenance={provenance} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return captured[captured.length - 1];
}

test('CSV carries the shared header block with source and fetch times kept apart', async () => {
  const file = await exportAs('CSV');
  expect(file.filename).toBe('fpt.csv');
  expect(file.text).toContain('# source_as_of,unknown');
  expect(file.text).toContain('# fetched_at,2026-11-02T03:00:00.000Z');
  expect(file.text).toContain('symbol,revenue');
});

test('JSON carries _provenance instead of raw rows', async () => {
  const file = await exportAs('JSON');
  const payload = JSON.parse(file.text);
  expect(file.filename).toBe('fpt.json');
  expect(payload.data).toEqual(rows);
  expect(payload._provenance.fetchedAt).toBe('2026-11-02T03:00:00.000Z');
});

test('the spreadsheet option emits a guarded workbook, not TSV', async () => {
  const file = await exportAs('Excel');
  expect(file.filename).toBe('fpt.xls');
  expect(file.text).toContain('ss:Name="Metadata"');
  expect(file.text).toContain('ss:Type="Number">63000<');
});
