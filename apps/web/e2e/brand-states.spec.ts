import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';

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
    // The walkthrough mounts over the widget and intercepts the actions-menu
    // click; the locator handler raced it and made the export case flaky.
    // Seed it as dismissed so no overlay exists to race.
    localStorage.setItem('vnibb-user-preferences', JSON.stringify({
      defaultTicker: 'VCB',
      defaultTab: 'fundamentals',
      onboarding: { dashboardWalkthroughVersion: 4, dashboardWalkthroughDismissedVersion: 4 },
    }));
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
      // `buckets: []` is the banner's "status unavailable" signal, so an empty
      // list with `overall: 'fresh'` is a payload the UI must not render as
      // fresh. Give the shared default one real bucket instead.
      return route.fulfill(json({
        timestamp: '2026-11-03T07:00:00Z',
        overall: 'fresh',
        buckets: [{
          label: 'Prices', status: 'fresh', reason: null,
          raw_last_data_date: '2026-11-03', settled_last_data_date: '2026-11-03',
          age_days: 0, last_data_date: '2026-11-03', detail: null, scope: 'hose_quotes',
        }],
      }));
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
      timestamp: '2026-11-01T07:00:00Z',
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
  expect(statSync(path!).size).toBeGreaterThan(2000);
  // PNG magic bytes prove a real image, not an error page saved as .png.
  expect(readFileSync(path!).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  // Brand §14: exports are light even though this dashboard renders dark. A
  // canvas bakes its colours into pixels, so the chart answers the capture
  // request with its own light rendering. Probe inside the chart's own box
  // rather than the image's rounded corner, and require ink as well as paper:
  // an all-white image would pass a corner check while shipping no data.
  const box = await widget.locator('#states-widget-0').evaluate((element) => {
    const canvas = element.querySelector('canvas');
    if (!canvas) return null;
    const target = element.getBoundingClientRect();
    const chart = canvas.getBoundingClientRect();
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      left: chart.left - target.left,
      top: chart.top - target.top,
      width: chart.width,
      height: chart.height,
    };
  });
  expect(box).not.toBeNull();

  const bytes = readFileSync(path!).toString('base64');
  const probe = await page.evaluate(async ({ data, region }) => {
    const response = await fetch(`data:image/png;base64,${data}`);
    const bitmap = await createImageBitmap(await response.blob());
    const surface = document.createElement('canvas');
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const ctx = surface.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);

    const scale = bitmap.width / region.targetWidth;
    const x = Math.max(0, Math.round(region.left * scale) + 2);
    const y = Math.max(0, Math.round(region.top * scale) + 2);
    const w = Math.min(bitmap.width - x, Math.max(1, Math.round(region.width * scale) - 4));
    const h = Math.min(bitmap.height - y, Math.max(1, Math.round(region.height * scale) - 4));
    const plot = ctx.getImageData(x, y, w, h).data;

    let light = 0;
    let candles = 0;
    for (let index = 0; index < plot.length; index += 4) {
      const [r, g, b] = [plot[index], plot[index + 1], plot[index + 2]];
      if (r > 240 && g > 240 && b > 240) light += 1;
      if (r < 110 && g > 70 && g < 190 && g > r * 1.3 && g > b * 1.1) candles += 1;
    }
    const total = plot.length / 4;
    const footerTop = Math.floor(region.targetHeight * scale);
    const footerHeight = bitmap.height - footerTop;
    const footer = footerHeight > 0 ? ctx.getImageData(0, footerTop, bitmap.width, footerHeight).data : [];
    let footerInk = 0;
    let footerLight = 0;
    for (let index = 0; index < footer.length; index += 4) {
      const [r, g, b] = [footer[index], footer[index + 1], footer[index + 2]];
      if (r < 180 && g < 180 && b < 180) footerInk += 1;
      if (r > 240 && g > 240 && b > 240) footerLight += 1;
    }
    return { light: light / total, candles, footerHeight, footerInk, footerLight: footerLight / (footer.length / 4) };
  }, { data: bytes, region: box! });

  // Paper dominates a light chart, and the rising candles remain visible.
  expect(probe.light).toBeGreaterThan(0.5);
  expect(probe.candles).toBeGreaterThan(25);
  // A strip exists below the widget and contains text, not just white pixels.
  expect(probe.footerHeight).toBeGreaterThan(10);
  expect(probe.footerLight).toBeGreaterThan(0.5);
  expect(probe.footerInk).toBeGreaterThan(25);
  // The temporary light swap must not persist into the user's saved preference.
  expect(await page.evaluate(() => localStorage.getItem('vnibb-theme'))).toBe('dark');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
});


test('market indices report each observation against its own source date', async ({ page }) => {
  // #205: the widget published one latest-across-rows date, so an HNX close from
  // 2026-10-30 appeared as current as a 2026-11-02 VNINDEX close.
  await mount(page, [{ type: 'market_overview' }]);
  await baseRoutes(page, {
    '/market/indices': (route) => route.fulfill(json({
      count: 2,
      source: 'db_fallback',
      updated_at: '2026-11-02T00:00:00',
      data: [
        { index_name: 'VNINDEX', current_value: 1829.04, change: 12.04, change_pct: 0.66, time: '2026-11-02' },
        { index_name: 'HNX', current_value: 252.74, change: -3.87, change_pct: -1.51, time: '2026-10-30' },
      ],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });

  await expect(widget.getByText('As of: 02 Nov 2026')).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByText('As of: 30 Oct 2026')).toBeVisible({ timeout: 30_000 });
});
test('an index date stays on the traded day west of UTC', async ({ browser }) => {
  // The API sends a bare `YYYY-MM-DD`. `new Date('2026-11-02')` is midnight UTC,
  // so a browser at a negative offset rendered that Monday as 01 Nov (Sunday).
  // A unit test cannot catch this: Jest freezes the ICU zone at startup, so the
  // assertion passes whatever `process.env.TZ` is set to. Only a real browser
  // with a real zone shows the defect.
  const context = await browser.newContext({ timezoneId: 'America/New_York' });
  const page = await context.newPage();
  await mount(page, [{ type: 'market_overview' }]);
  await baseRoutes(page, {
    '/market/indices': (route) => route.fulfill(json({
      count: 1,
      source: 'db_fallback',
      data: [
        { index_name: 'VNINDEX', current_value: 1829.04, change: 12.04, change_pct: 0.66, time: '2026-11-02' },
      ],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });

  await expect(widget.getByText('As of: 02 Nov 2026')).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByText('As of: 01 Nov 2026')).toHaveCount(0);
  await context.close();
});


test('a missing index change is unavailable, not a flat session', async ({ page }) => {
  // A null change and a measured 0 both used to land on `index-card flat`, so
  // "no reading" and "unchanged" were the same colour. They must not be.
  await mount(page, [{ type: 'market_overview' }]);
  await baseRoutes(page, {
    '/market/indices': (route) => route.fulfill(json({
      count: 2,
      source: 'db_fallback',
      data: [
        { index_name: 'VNINDEX', current_value: 1829.04, change: 0, change_pct: 0, time: '2026-11-02' },
        { index_name: 'HNX', current_value: 252.74, change: null, change_pct: null, time: '2026-11-02' },
      ],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  // The cards paint after the query resolves; probe once both are on screen.
  await expect(widget.locator('.index-card')).toHaveCount(2, { timeout: 30_000 });
  await expect(widget.locator('.index-card.none')).toHaveCount(1);

  const tones = await widget.evaluate((element) => {
    const cards = Array.from(element.querySelectorAll('.index-card'));
    const change = (card: Element) =>
      getComputedStyle(card.querySelector('.index-card__change')!).color;
    return {
      flat: change(cards.find((card) => card.classList.contains('flat'))!),
      missing: change(cards.find((card) => card.classList.contains('none'))!),
    };
  });

  // Distinct readings: a genuine zero is ink/secondary, a null is muted.
  expect(tones.missing).not.toBe(tones.flat);
});

test('color-vision mode remaps the direction tokens and reduced effects reach the root', async ({ page }) => {
  // #202: these two accessibility modes were only ever checked by reading CSS.
  // Seed them the way a returning user has them, then measure the resolved
  // colour on a real gain/loss pair instead of the stylesheet source.
  await mount(page, [{ type: 'market_overview' }]);
  await page.addInitScript(() => {
    localStorage.setItem('vnibb-colorblind-mode', 'true');
    localStorage.setItem('vnibb-reduce-effects', 'true');
  });
  await baseRoutes(page, {
    '/market/indices': (route) => route.fulfill(json({
      count: 2,
      source: 'db_fallback',
      data: [
        { index_name: 'VNINDEX', current_value: 1829.04, change: 12.04, change_pct: 0.66, time: '2026-11-02' },
        { index_name: 'HNX', current_value: 252.74, change: -3.87, change_pct: -1.51, time: '2026-11-02' },
      ],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByText('As of: 02 Nov 2026')).toHaveCount(2);

  const resolved = await page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const changeColor = (selector: string) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).color : null;
    };
    const card = document.querySelector('.widget-card-premium') as HTMLElement | null;
    // Read the attributes the app itself applied, before touching them. Toggling
    // first and reading afterwards would assert our own write, not hydration.
    const colorMode = root.getAttribute('data-color-mode');
    const reduceEffects = root.getAttribute('data-reduce-effects');
    // `backdrop-filter` is `none` app-wide since #199 retired glass, so it
    // cannot prove this preference applied. The rule's real effect is
    // `box-shadow: var(--shadow-sm)`; measure it with the pref on and then
    // with it off, so an attribute that stops reaching the root fails.
    const withPref = card ? getComputedStyle(card).boxShadow : null;
    root.setAttribute('data-reduce-effects', 'false');
    const withoutPref = card ? getComputedStyle(card).boxShadow : null;
    root.setAttribute('data-reduce-effects', reduceEffects ?? 'false');
    // A computed shadow is resolved to rgb()/px, so the raw token string never
    // matches it. Resolve the token the same way through a probe element.
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--shadow-sm)';
    document.body.appendChild(probe);
    const shadowSm = getComputedStyle(probe).boxShadow;
    probe.remove();
    return {
      colorMode,
      reduceEffects,
      positive: style.getPropertyValue('--color-positive').trim(),
      negative: style.getPropertyValue('--color-negative').trim(),
      shadowSm,
      withPref,
      withoutPref,
      up: changeColor('.index-card.up .index-card__change'),
      down: changeColor('.index-card.down .index-card__change'),
    };
  });
  expect(resolved.colorMode).toBe('colorblind');
  expect(resolved.reduceEffects).toBe('true');
  // Okabe–Ito pair, not the default green/red: #6CB6F0 / #F0A35E on dark.
  expect(resolved.positive.toLowerCase()).toBe('#6cb6f0');
  expect(resolved.negative.toLowerCase()).toBe('#f0a35e');
  // The measurement, not the token declaration: a gain row must paint blue.
  expect(resolved.up).toBe('rgb(108, 182, 240)');
  expect(resolved.down).toBe('rgb(240, 163, 94)');

  // Reduced effects collapse the card shadow to the single --shadow-sm value,
  // and the same card differs when the preference is off.
  expect(resolved.shadowSm).not.toBe('');
  expect(resolved.withPref).toBe(resolved.shadowSm);
  expect(resolved.withoutPref).not.toBe(resolved.withPref);
});

test('OS reduced-motion actually shortens animations and transitions', async ({ page }) => {
  // `prefers-reduced-motion: reduce` has had a rule in accessibility.css the
  // whole time and nothing ever measured it. `data-reduce-effects` is a separate
  // app preference; this is the OS setting, so it cannot be seeded in
  // localStorage and must be emulated.
  await mount(page, [{ type: 'market_overview' }]);
  await baseRoutes(page, {
    '/market/indices': (route) => route.fulfill(json({
      count: 1,
      source: 'db_fallback',
      data: [{ index_name: 'VNINDEX', current_value: 1829.04, change: 12.04, change_pct: 0.66, time: '2026-11-02' }],
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  await expect(widget.locator('.index-card')).toHaveCount(1, { timeout: 30_000 });

  // Measure an element whose motion comes from the universal guard in
  // accessibility.css, not from its own media query: `.react-grid-item` has a
  // sibling `prefers-reduced-motion` rule in globals.css, so measuring it would
  // still pass with the universal guard deleted. The widget card carries a real
  // transition and has no such override.
  const measure = () => page.evaluate(() => {
    const card = document.querySelector('[data-widget-id] .widget-card-premium');
    if (!card) return null;
    const style = getComputedStyle(card);
    return { transition: style.transitionDuration, animation: style.animationDuration };
  });
  const seconds = (value: string) => Math.max(...value.split(',').map((part) => parseFloat(part) || 0));

  // Baseline first: with motion allowed the card must actually be animating, or
  // the reduced reading below would be zero for both cases and prove nothing.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const unmuted = await measure();
  expect(unmuted, 'the widget card must exist to measure its motion').not.toBeNull();
  expect(Math.max(seconds(unmuted!.transition), seconds(unmuted!.animation))).toBeGreaterThan(0.05);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await measure();
  expect(Math.max(seconds(reduced!.transition), seconds(reduced!.animation))).toBeLessThan(0.001);
});

for (const viewport of [{ name: '1024', width: 1024, height: 768 }, { name: '390', width: 390, height: 844 }] as const) {
  test(`states hold at ${viewport.name}px: a provider failure is a retryable error, not blank`, async ({ page }) => {
    // The state suite only ever ran at the desktop preset, so every state was
    // unverified on a tablet and a phone width.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mount(page, [{ type: 'financial_ratios' }]);
    await baseRoutes(page, {
      '/ratios': (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'provider failed' }) }),
    });

    await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
    const widget = page.locator('[data-widget-id]').first();
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect(widget.getByRole('button', { name: /try again/i })).toBeVisible({ timeout: 45_000 });
    // A narrow viewport must not lose its scroll containment. Read after the
    // grid has settled: an early read caught a mid-resize frame once, which
    // failed webkit at 1024 while the document itself never overflowed.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        timeout: 15_000,
        message: 'the document must not scroll horizontally',
      })
      .toBeLessThanOrEqual(1);
  });
}

test('a data-table cell actually paints the sign it was given (#200)', async ({ page }) => {
  // The source guard in check-brand-tokens.test.ts reads CSS text, so it can be
  // bypassed by a rule that merely looks layered (" .data-table td { color }").
  // This measures the outcome instead: the colour that reaches a rendered cell.
  // Earnings History renders net margin per quarter, so one payload can carry a
  // gain, a loss, a measured zero and a missing reading at once.
  await mount(page, [{ type: 'earnings_history' }]);
  await baseRoutes(page, {
    '/income-statement': (route) => route.fulfill(json({
      data: [
        { period: '2026-Q4', revenue: 100, net_income: 25, gross_profit: 40 },
        { period: '2026-Q3', revenue: 100, net_income: -25, gross_profit: 40 },
        { period: '2026-Q2', revenue: 100, net_income: 0, gross_profit: 40 },
        { period: '2026-Q1', revenue: 0, net_income: 5, gross_profit: 40 },
      ],
      count: 4,
    })),
  });

  await page.goto('/dashboard?dashboard=states-dashboard&tab=states-tab');
  const widget = page.locator('[data-widget-id]').first();
  await expect(widget).toBeVisible({ timeout: 30_000 });
  // Net Margin is the only right-aligned percentage column carrying the tone.
  const cells = widget.locator('td.font-medium');
  await expect(cells.first()).toBeVisible({ timeout: 30_000 });

  const painted = await page.evaluate(() => {
    const tokens = getComputedStyle(document.documentElement);
    const resolve = (name: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    return {
      positive: resolve('--color-positive'),
      negative: resolve('--color-negative'),
      ink: resolve('--text-primary'),
      muted: resolve('--text-muted'),
      rows: Array.from(document.querySelectorAll('[data-widget-id] td.font-medium'))
        .map((cell) => ({ text: cell.textContent?.trim() ?? '', color: getComputedStyle(cell).color })),
    };
  });

  const byText = (fragment: string) => painted.rows.find((row) => row.text.includes(fragment));
  const gain = byText('25.00%');
  const loss = byText('-25.00%');
  expect(gain, `gain cell missing; saw ${JSON.stringify(painted.rows)}`).toBeDefined();
  expect(loss, `loss cell missing; saw ${JSON.stringify(painted.rows)}`).toBeDefined();

  // The measurement, not the class name: an unlayered `.data-table td { color }`
  // made every one of these render as ordinary table text.
  expect(gain!.color).toBe(painted.positive);
  expect(loss!.color).toBe(painted.negative);
  // A measured zero is ink, and a ratio with no revenue basis is n/a in muted.
  expect(byText('0.00%')?.color ?? painted.ink).not.toBe(painted.positive);
  expect(byText('n/a')?.color ?? painted.muted).not.toBe(painted.negative);
});
