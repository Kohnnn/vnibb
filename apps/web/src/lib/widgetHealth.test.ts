import { deriveWidgetHealth } from './widgetHealth';
import { buildWidgetRuntime, type WidgetRuntimeInput } from './widgetRuntime';
import type { ExportProvenance } from './exportWidget';

const NOW = new Date('2026-10-08T03:00:00Z').getTime();
const OLD = '2026-09-21T15:00:00Z';
const FRESH = '2026-10-08T02:00:00Z';

function health(input: WidgetRuntimeInput) {
  const payload = buildWidgetRuntime(input);
  const runtime = payload.__widgetRuntime as { provenance: Partial<ExportProvenance> };
  return { provenance: runtime.provenance, state: deriveWidgetHealth(runtime.provenance) };
}

const base = { empty: false, apiGroup: '/news', endpoint: '/news/market' };

describe('source observation freshness', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('marks a fresh source observation live, not merely a fresh retrieval', () => {
    expect(health({ ...base, lastDataDate: FRESH, fetchedAt: NOW }).state?.status).toBe('live');
  });

  it('preserves stale-success and cached-success independently', () => {
    expect(health({ ...base, lastDataDate: FRESH, stale: true }).state?.status).toBe('stale');
    expect(health({ ...base, lastDataDate: FRESH, cached: true }).state?.status).toBe('cached');
  });

  it('refetching unchanged old data changes retrieval only and never becomes live', () => {
    const previous = health({ ...base, lastDataDate: OLD, fetchedAt: NOW - 60000 });
    const refreshed = health({ ...base, lastDataDate: OLD, fetchedAt: NOW });
    expect(refreshed.provenance.updatedAt).toBe(previous.provenance.updatedAt);
    expect(refreshed.provenance.fetchedAt).not.toBe(previous.provenance.fetchedAt);
    expect(refreshed.state?.status).toBe('stale');
  });

  it('reports refresh error with cache as stale cached evidence', () => {
    const result = health({ ...base, lastDataDate: FRESH, cached: true, stale: true });
    expect(result.provenance).toMatchObject({ cached: true, stale: true });
    expect(result.state?.detail).toContain('cached');
  });

  it.each([null, undefined, '', 'invalid'])('does not invent as-of from receipt time: %s', (lastDataDate) => {
    const result = health({ ...base, lastDataDate, fetchedAt: NOW });
    expect(result.state?.status).toBe('unknown');
    expect(result.state?.label).not.toBe('Live');
  });

  it('keeps cached state without claiming known source age', () => {
    expect(health({ ...base, fetchedAt: NOW, cached: true }).state).toMatchObject({
      status: 'cached', detail: expect.stringContaining('unknown'),
    });
  });

  it('distinguishes declared market closure from stale source or outage', () => {
    expect(health({ ...base, lastDataDate: FRESH, marketClosed: true }).state?.label).toBe('Market closed');
    expect(health({ ...base, lastDataDate: OLD, marketClosed: true }).state?.status).toBe('stale');
    expect(health({ ...base, lastDataDate: OLD, marketClosed: true, stale: true }).state?.status).toBe('stale');
    expect(health({ ...base, marketClosed: true }).state?.status).toBe('unknown');
  });
  it('does not claim full coverage from a fresh partial observation', () => {
    expect(health({ ...base, lastDataDate: FRESH, coverage: 'partial' }).state?.status).toBe('coverage_gap');
  });

  it('ages date-only observations by the day while full timestamps keep the 6h window', () => {
    // "2026-10-08" parses to midnight UTC, so the 6h window reported the current
    // session as Stale from 13:00 ICT with no data change (issue #105).
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-08T14:00:00Z').getTime());
    expect(health({ ...base, lastDataDate: '2026-10-08' }).state?.status).toBe('live');
    expect(health({ ...base, lastDataDate: '2026-10-08T02:00:00Z' }).state?.status).toBe('stale');

    // A date-only observation is still not fresh once its day has passed.
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-09T01:00:00Z').getTime());
    expect(health({ ...base, lastDataDate: '2026-10-08' }).state?.status).toBe('stale');
  });
});
