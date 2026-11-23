import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { provenanceLines } from '@/lib/widgetProvenance';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { GapFillStatsWidget } from './GapFillStatsWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const fixturePath = process.env.VNIBB_HISTORY_CONTRACT_REPLAY;
const itWithRouteOutput = fixturePath ? it : it.skip;

itWithRouteOutput.each(['unresolved', 'replaced'] as const)('uses exact historical route output: %s', async (kind) => {
  // The same serialized ASGI responses also exercise ATR. Jul 2 follows the
  // incompatible Jul 1 candidates; only an admitted Jul 1 makes that gap eligible.
  const payloads: Record<typeof kind, EquityHistoricalResponse> = JSON.parse(readFileSync(fixturePath!, 'utf8'));
  const originalFetch = globalThis.fetch;
  const fetchReplay = jest.fn(async () => ({ ok: true, json: async () => payloads[kind] }) as Response);
  globalThis.fetch = fetchReplay;
  const publish = jest.fn<void, [WidgetDataPayload]>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    render(<QueryClientProvider client={client}><GapFillStatsWidget symbol="XYZ" onDataChange={publish} /></QueryClientProvider>);
    if (kind === 'unresolved') {
      expect(await screen.findByText('No qualifying gaps among eligible comparisons')).toBeInTheDocument();
      expect(screen.getByText(/37 eligible comparisons · 2 excluded/)).toBeInTheDocument();
    } else {
      expect(await screen.findByText('Filled: same session (0)')).toBeInTheDocument();
      expect(screen.getByText(/39 eligible comparisons · 0 excluded/)).toBeInTheDocument();
    }
    expect(fetchReplay).toHaveBeenCalledWith(expect.stringContaining('/api/v1/equity/historical?'), expect.anything());
    await waitFor(() => expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject(kind === 'unresolved' ? {
      eligibleComparisons: 37, excludedComparisons: 2, gaps: 0, resolvedGaps: 0,
      fillRatePct: null, avgFillTradingSessions: null,
    } : {
      eligibleComparisons: 39, excludedComparisons: 0, gaps: 1, filledGaps: 1, resolvedGaps: 1,
      fillRatePct: 100, avgFillTradingSessions: 0,
    }));
    expect(provenanceLines(publish.mock.lastCall?.[0].__widgetRuntime?.provenance)).toEqual(expect.arrayContaining([
      ['observation_status', 'available'], ['source_as_of', '2026-07-31'],
      ['coverage', kind === 'unresolved' ? 'partial' : 'complete'],
      ['gap_sessions', kind === 'unresolved' ? '1' : '0'],
    ]));
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});
