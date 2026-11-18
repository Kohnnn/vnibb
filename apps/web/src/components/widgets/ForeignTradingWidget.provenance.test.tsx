import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getForeignTrading } from '@/lib/api';
import type { ReactNode } from 'react';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import { provenanceToMarkdown } from '@/lib/exportWidget';
import type { ForeignTradingResponse } from '@/types/equity';
import { ForeignTradingWidget } from './ForeignTradingWidget';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getForeignTrading: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const friday = '2026-11-13';
const fridayClosure = {
  date: friday,
  checked_at: '2026-11-13T10:01:00Z',
  valid_until: '2026-11-16T02:00:00Z',
};

function fridayWindow(observation: string, warning: string | null = null) {
  const meta = {
    count: 1, last_data_date: observation,
    // 57 exchange sessions: the Aug 31–Sep 2 closures are not sessions.
    requested_start_date: '2026-08-24', requested_end_date: friday, requested_session_count: 57,
    observed_start_date: observation, observed_end_date: observation, observed_session_count: 1,
    last_validated_session: observation, gap_session_count: 56, coverage_status: 'partial',
    window_contract: 'sessions', calendar_verified: true, latest_closed_session: fridayClosure,
    warnings: warning ? [warning] : [],
  } as const;
  return {
    symbol: 'HPG', count: 1, error: warning, meta,
    data: [{ symbol: 'HPG', date: observation, buy_volume: 1200, sell_volume: 1200 }],
  } satisfies ForeignTradingResponse;
}

describe('Foreign Trading weekend provenance (#270)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    {
      case: 'a failed refresh on Saturday retains Friday',
      now: '2026-11-14T06:00:00Z',
      observation: '2026-11-13',
      warning: 'live foreign trading feed timed out; using cached database fallback',
      bodyStatus: /^Cached snapshot/,
      status: 'cached',
      cached: true,
      stale: false,
      expectedClosedSession: true,
      refreshStatus: 'failed',
    },
    {
      case: 'a Thursday observation misses the Friday session on Sunday',
      now: '2026-11-15T06:00:00Z',
      observation: '2026-11-12',
      warning: null,
      bodyStatus: /^Stale/,
      status: 'stale',
      cached: false,
      stale: true,
      expectedClosedSession: false,
      refreshStatus: 'succeeded',
    },
    {
      case: 'the envelope contains only a coverage warning on Saturday',
      now: '2026-11-14T06:00:00Z',
      observation: '2026-11-13',
      warning: '56 requested market sessions are missing',
      bodyStatus: /^Partial coverage/,
      status: 'coverage_gap',
      cached: false,
      stale: false,
      expectedClosedSession: true,
      refreshStatus: 'succeeded',
    },
  ])('keeps source health and coverage when $case', async ({
    now, observation, warning, bodyStatus, status, cached, stale, expectedClosedSession, refreshStatus,
  }) => {
    const receiptTime = Date.parse(now);
    jest.setSystemTime(receiptTime);
    jest.spyOn(Date, 'now').mockReturnValue(receiptTime);
    const response = fridayWindow(observation, warning);
    jest.mocked(getForeignTrading).mockResolvedValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDataChange = jest.fn<void, [WidgetDataPayload]>();

    const view = render(
      <QueryClientProvider client={client}>
        <ForeignTradingWidget id="foreign-weekend" symbol="HPG" onDataChange={onDataChange} />
      </QueryClientProvider>,
    );

    try {
      expect(await screen.findByText(bodyStatus)).toBeVisible();
      const payload = onDataChange.mock.lastCall?.[0];
      const provenance = payload?.__widgetRuntime?.provenance;
      expect(screen.getByText(/1\/57 sessions/)).toBeVisible();
      expect(provenance).toMatchObject({
        cached, stale, expectedClosedSession, refreshStatus,
        updatedAt: observation, fetchedAt: receiptTime, marketClosed: true, coverage: 'partial',
        observationStatus: 'available',
        coverageDetail: {
          requestedStart: '2026-08-24', requestedEnd: friday, requestedSessions: 57,
          observedStart: observation, observedEnd: observation, observedSessions: 1,
          lastValidatedSession: observation, gapSessions: 56, calendarVerified: true,
        },
        warnings: warning ? [warning] : [],
      });
      if (!provenance) throw new Error('Missing widget provenance');
      const health = deriveWidgetHealth(provenance);
      expect(health.status).toBe(status);
      expect(provenanceToMarkdown(provenance)).toContain(`- Data status: ${health.label}`);
      expect(getWidgetExportData(payload)).toEqual(response.data);
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('drops closure qualification at reopening without a new query response', async () => {
    const reopen = Date.parse(fridayClosure.valid_until);
    jest.setSystemTime(reopen - 1000);
    jest.mocked(getForeignTrading).mockResolvedValue(fridayWindow(friday));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDataChange = jest.fn<void, [WidgetDataPayload]>();
    const view = render(
      <QueryClientProvider client={client}>
        <ForeignTradingWidget id="foreign-reopening" symbol="HPG" onDataChange={onDataChange} />
      </QueryClientProvider>,
    );

    try {
      expect(await screen.findByText(/^Partial coverage/)).toBeVisible();
      const initial = onDataChange.mock.lastCall?.[0].__widgetRuntime?.provenance;
      expect(initial).toMatchObject({ marketClosed: true, expectedClosedSession: true });

      await act(() => jest.advanceTimersByTimeAsync(reopen - Date.now()));

      expect(screen.getByText(/^Stale/)).toBeVisible();
      const current = onDataChange.mock.lastCall?.[0].__widgetRuntime?.provenance;
      expect(current).toMatchObject({ updatedAt: friday, fetchedAt: initial?.fetchedAt, expectedClosedSession: false });
      expect(current?.marketClosed).toBeUndefined();
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('retains the Nov 13 observation and its receipt after a rejected Nov 21 refresh', async () => {
    const receipt = Date.parse('2026-11-13T10:05:00Z');
    jest.setSystemTime(receipt);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(receipt);
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const response = fridayWindow(friday);
    jest.mocked(getForeignTrading)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error('controlled transport rejection'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDataChange = jest.fn<void, [WidgetDataPayload]>();
    const view = render(
      <QueryClientProvider client={client}>
        <ForeignTradingWidget id="foreign-rejected-refresh" symbol="HPG" onDataChange={onDataChange} />
      </QueryClientProvider>,
    );

    try {
      expect(await screen.findByText(friday)).toBeVisible();
      const initial = onDataChange.mock.lastCall?.[0].__widgetRuntime?.provenance;
      expect(initial).toMatchObject({
        updatedAt: friday, fetchedAt: receipt, cached: false, stale: false,
        expectedClosedSession: true, refreshStatus: 'succeeded',
      });
      const later = Date.parse('2026-11-21T03:00:00Z');
      jest.setSystemTime(later);
      clock.mockReturnValue(later);
      const refresh = screen.getByRole('button', { name: 'Refresh' });
      // The pending state can also be stale; assert only after the query rejects.
      let unsubscribe = () => {};
      const rejection = new Promise<void>(resolve => {
        unsubscribe = client.getQueryCache().subscribe(event => {
          if (event.type === 'updated' && event.action.type === 'error') resolve();
        });
      });
      try {
        await act(async () => {
          fireEvent.click(refresh);
          await rejection;
          await jest.advanceTimersByTimeAsync(0);
        });
      } finally {
        unsubscribe();
      }
      expect(screen.getByText(friday)).toBeVisible();
      const payload = onDataChange.mock.lastCall?.[0];
      expect(getWidgetExportData(payload)).toEqual(response.data);
      const retained = payload?.__widgetRuntime?.provenance;
      expect(retained).toMatchObject({
        updatedAt: friday, fetchedAt: receipt, cached: true, stale: true,
        expectedClosedSession: false, refreshStatus: 'failed', coverage: 'partial',
      });
      expect(retained?.marketClosed).toBeUndefined();
      expect(screen.getByText(/^Stale/)).toBeVisible();
    } finally {
      view.unmount();
      client.clear();
    }
  });
});
