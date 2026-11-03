import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * #202 state matrix.
 *
 * Each case mounts exactly one widget so a state assertion cannot be satisfied
 * by a neighbour. Bodies are per-endpoint: a blanket `{data:[],count:0}` kills
 * the shell (news feed expects `articles`, freshness expects `buckets`).
 */

const SCREENER_ROWS = [
  {
    ticker: 'VCB', symbol: 'VCB', company_name: 'Vietcombank', exchange: 'HOSE',
    price: 92000, change_1d: 1.2, market_cap: 770000, pe: 14.2, dividend_yield: 2.1,
  },
];

type Widget = { type: string; syncGroupId?: number; config?: Record<string, unknown>; layout?: Record<string, number> };

async function mount(page: Page, widgets: Widget[]) {
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'VniBB walkthrough' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Close walkthrough' }).click();
  });

  await page.addInitScript((mounted) => {
    localStorage.setItem('vnibb-dashboard-version', 'v74');
    localStorage.setItem('vnibb_migration_version', '27');
    // The read path treats a missing commit marker as unreadable storage and
    // falls back to the built-in workspaces, so the seeded tab never activated.
    localStorage.setItem('vnibb-dashboard-storage-commit', 'committed');
    localStorage.setItem('vnibb_folders', JSON.stringify([{ id: 'f-states', name: 'States', order: 0, isExpanded: true }]));
    localStorage.setItem('vnibb_dashboards', JSON.stringify([{
      id: 'states-dashboard', name: 'States', folderId: 'f-states', order: 0,
      isDefault: false, isEditable: true, adminUnlocked: false, showGroupLabels: false,
      tabs: [{
        id: 'states-tab', name: 'Overview', order: 0,
        dashboardId: 'states-dashboard',
        widgets: mounted.map((widget, index) => ({
          id: `states-widget-${index}`,
          tabId: 'states-tab',
          type: widget.type,
          ...(widget.syncGroupId === undefined ? {} : { syncGroupId: widget.syncGroupId }),
          config: widget.config ?? {},
          // isFiniteLayout requires string `i` plus finite x/y/w/h; a missing
          // tabId or `i` fails validation and the page boundary swallows the app.
          layout: {
            i: `states-widget-${index}`,
            x: 0, y: index * 8, w: 32, h: 8, minW: 8, minH: 4,
            ...(widget.layout ?? {}),
          },
        })),
      }],
      syncGroups: [],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }]));
    localStorage.setItem('vnibb-dashboard-last-view', JSON.stringify({
      activeDashboardId: 'states-dashboard',
      lastActiveTabIdByDashboard: { 'states-dashboard': 'states-tab' },
    }));
    localStorage.setItem('vnibb-user-preferences', JSON.stringify({ defaultTicker: 'VCB', defaultTab: 'fundamentals' }));
  }, widgets);
}

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

/** Shell-safe defaults: correct shape for every endpoint that is not the case under test. */
async function baseRoutes(
  page: Page,
  overrides: Record<string, (route: Route) => Promise<void>> = {},
) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // An override must fulfil the route it is handed; calling page.route() from
    // inside a handler never registers a second handler and silently fell back
    // to the default body, which is why every case looked like an empty payload.
    for (const [fragment, handler] of Object.entries(overrides)) {
      if (path.includes(fragment)) {
        await handler(route);
        return;
      }
    }

    if (path.endsWith('/search/tickers')) return route.continue();
    if (path.endsWith('/screener/')) {
      const exchange = url.searchParams.get('exchange');
      const data = exchange ? SCREENER_ROWS.filter((row) => row.exchange === exchange) : SCREENER_ROWS;
      return route.fulfill(json({ data, meta: { count: data.length, source: 'live' } }));
    }
    if (path.endsWith('/market/freshness')) {
      return route.fulfill(json({ overall: 'fresh', buckets: [] }));
    }
    if (path.includes('/news/feed')) return route.fulfill(json({ articles: [] }));
    if (path.includes('/system-layouts')) return route.fulfill(json({ data: [] }));
    return route.fulfill(json({ data: [], count: 0 }));
  });
}

test('ratio 500 with no rows renders the widget error state, not blank', async ({ page }) => {
  await mount(page, [{ type: 'financial_ratios' }]);
  await baseRoutes(page, {
    '/ratios': (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'provider failed' }) }),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  // queryRetry retries a 500 three times (1s/2s/4s), so allow for the backoff.
  await expect(widget.getByRole('button', { name: /try again/i })).toBeVisible({ timeout: 45_000 });
});

test('ratio empty state is an explanatory empty, not an error', async ({ page }) => {
  await mount(page, [{ type: 'financial_ratios' }]);
  await baseRoutes(page, {
    '/ratios': (route) => route.fulfill(json({ data: [], count: 0 })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  // The active symbol comes from the workspace, not this spec: assert the empty
  // message shape rather than pinning a ticker the harness does not control.
  await expect(widget.getByText(/no ratio data for /i)).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByRole('button', { name: /try again/i })).toHaveCount(0);
});

test('partial freshness shows the bucket line and keeps critical styling neutral', async ({ page }) => {
  await mount(page, [{ type: 'key_metrics' }]);
  await baseRoutes(page, {
    '/market/freshness': (route) => route.fulfill(json({
      overall: 'partial',
      buckets: [{
        label: 'Prices', status: 'partial', reason: 'latest_sync_unsettled',
        raw_last_data_date: '2026-11-01', settled_last_data_date: '2026-10-31',
        age_days: 2, last_data_date: '2026-10-31', detail: 'settling window', scope: 'hose_quotes',
      }],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const banner = page.getByRole('status').filter({ hasText: 'Prices' });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  // The banner renders `current through …; validated through …` as visible text;
  // `bucket.detail` is only the title attribute. Assert what is on screen.
  await expect(banner.getByText(/current through 2026-11-01; validated through 2026-10-31/)).toBeVisible();
  await expect(banner.getByText(/Prices \(hose quotes\):/)).toBeVisible();
});

test('empty dataset keeps the shell alive instead of tripping the route error boundary', async ({ page }) => {
  await mount(page, [{ type: 'news_feed' }]);
  await baseRoutes(page);
  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  await expect(page.locator('[data-widget-id]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});

test('PNG export downloads a real image for a chart widget', async ({ page }) => {
  // Dev-mode first compile plus a 60-row chart exceeds the 30s default.
  test.setTimeout(180_000);
  await mount(page, [{
    type: 'price_chart', syncGroupId: 1,
    config: { timeframe: '1Y', chartType: 'candle' },
    layout: { x: 0, y: 0, w: 32, h: 12, minW: 8, minH: 6 },
  }]);
  await page.addInitScript(() => localStorage.setItem('vnibb-theme', 'dark'));
  await baseRoutes(page, {
    '/equity/historical': (route) => route.fulfill(json({
      // `time` and a row-level price_unit are the chart's own certification
      // inputs; a `date` field or response-level unit would normalize to zero rows.
      data: Array.from({ length: 60 }, (_, i) => ({
        time: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00`,
        open: 90000 + i * 30, high: 90500 + i * 30, low: 89500 + i * 30,
        close: 90100 + i * 30, volume: 1_000_000 + i * 1000, price_unit: 'VND',
      })),
      count: 60,
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });

  // A canvas with drawn pixels is the precondition for a meaningful export.
  const canvas = widget.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 45_000 });

  const download = page.waitForEvent('download', { timeout: 45_000 });
  await widget.getByRole('button', { name: /widget actions for/i }).click();
  // DropdownMenuSubTrigger toggles on click (no hover-intent), so hover leaves
  // the submenu closed and the PNG item unreachable.
  await page.getByRole('menuitem', { name: /^export$/i }).click();
  await page.getByRole('menuitem', { name: /export as png/i }).click();

  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();
  const { statSync, readFileSync } = await import('node:fs');
  expect(statSync(path!).size).toBeGreaterThan(2000);
  // PNG magic bytes prove a real image, not an error page saved as .png.
  expect(readFileSync(path!).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  // Not asserted: a light export surface. `exportToPNG` paints whatever theme is
  // live, and a chart's candles/background are baked into its own canvas bitmap
  // at creation (TradingViewAdvancedChart reads --bg-primary), so html2canvas
  // copies those dark pixels regardless of CSS theming. Brand §14 wants light
  // exports by default; that needs the chart re-rendered on a light palette
  // before capture, which this spec does not do. Tracked as an open gap.

});
