import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const screenerRows = [
  {
    ticker: 'VCB',
    symbol: 'VCB',
    company_name: 'Vietcombank',
    exchange: 'HOSE',
    price: 92000,
    change_1d: 1.2,
    market_cap: 770000,
    pe: 14.2,
    dividend_yield: 2.1,
  },
  {
    ticker: 'SHS',
    symbol: 'SHS',
    company_name: 'Saigon Hanoi Securities',
    exchange: 'HNX',
    price: 15500,
    change_1d: -0.5,
    market_cap: 12000,
    pe: 9.8,
    dividend_yield: 1.4,
  },
];

/** Mirrors the synthetic row in the gate's stdlib browser fixture; no backend serves search. */
const tickerRows = [{ symbol: 'VCB', name: 'Vietcombank', type: 'vn_stock', exchange: 'HOSE', tv_symbol: 'HOSE:VCB' }];

/**
 * The built shell is served from the web origin but calls `http://localhost:8000`
 * cross-origin, so every synthetic reply — payload or preflight — must carry CORS
 * or the browser discards it before the app ever sees a row.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
};
const json = (body: unknown) => ({ contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) });
/** Only the loopback API port is answered synthetically; every other host/port is refused. */
const isLoopbackApi = (url: URL) => ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8000';

/**
 * Containment: routed sockets are closed without ever calling `connectToServer`.
 * Only GET/HEAD may leave the browser: the exact web origin of `baseURL` passes
 * through, and the loopback API host is answered here synthetically, since the
 * built shell hardcodes `http://localhost:8000`. `page.route` handlers still win
 * over this context route, so the fixtures below fulfil first and this only sees
 * what escaped them.
 */
async function installNetworkGuard(context: BrowserContext, baseURL?: string) {
  const webOrigin = new URL(baseURL ?? 'http://127.0.0.1:3101').origin;
  // Sandboxed (bwrap) Chromium reports `navigator.onLine === false`, so `fetchAPI`
  // throws `Offline` before issuing the request and the query provider pauses.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.abort();
    if (isLoopbackApi(url)) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
      const body = url.pathname === '/api/v1/search/tickers'
        ? { results: tickerRows, count: tickerRows.length }
        : { data: [], count: 0 };
      return route.fulfill(json(body));
    }
    if (['GET', 'HEAD'].includes(request.method()) && url.origin === webOrigin && !url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    return route.abort();
  });
}

// The delayed walkthrough overlays What's new; dismiss the topmost dialog first.
async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  const walkthrough = page.getByRole('dialog', { name: 'VniBB walkthrough' });
  await expect(walkthrough).toBeVisible();
  await walkthrough.getByRole('button', { name: 'Close walkthrough' }).click();
  await expect(walkthrough).toBeHidden();
  const whatsNew = page.getByRole('dialog', { name: "What's new" });
  await whatsNew.getByRole('button', { name: "Dismiss what's new" }).click();
  await expect(whatsNew).toBeHidden();
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await installNetworkGuard(context, baseURL);

  await page.addInitScript(() => {
    localStorage.setItem('vnibb-dashboard-version', 'v74');
    localStorage.setItem('vnibb_migration_version', '23');
    localStorage.setItem('vnibb_folders', JSON.stringify([{ id: 'folder-initial', name: 'Initial', order: 0, isExpanded: true }]));
    localStorage.setItem('vnibb_dashboards', JSON.stringify([{
      id: 'release-smoke-dashboard',
      name: 'Fundamentals',
      folderId: 'folder-initial',
      order: 0,
      isDefault: false,
      isEditable: true,
      adminUnlocked: false,
      showGroupLabels: false,
      tabs: [{ id: 'release-smoke-tab', name: 'Overview', order: 0, widgets: [] }],
      syncGroups: [],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }]));
    localStorage.setItem('vnibb-dashboard-last-view', JSON.stringify({
      activeDashboardId: 'release-smoke-dashboard',
      lastActiveTabIdByDashboard: { 'release-smoke-dashboard': 'release-smoke-tab' },
    }));
    localStorage.setItem('vnibb-user-preferences', JSON.stringify({
      defaultTicker: 'VCB',
      defaultTab: 'fundamentals',
    }));
  });

  await page.route('**/api/v1/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    // Anything but the loopback API host is not ours to answer: fall back so the
    // context allowlist decides (pass the web origin's assets, refuse the rest).
    if (!isLoopbackApi(url)) return route.fallback();
    // The shell is cross-origin to the API, so the browser preflights first.
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
    if (!['GET', 'HEAD'].includes(method)) return route.abort();
    if (url.pathname.endsWith('/search/tickers')) {
      return route.fulfill(json({ results: tickerRows, count: tickerRows.length }));
    }
    if (url.pathname.endsWith('/screener/')) {
      const exchange = url.searchParams.get('exchange');
      return route.fulfill(json({
        data: exchange ? screenerRows.filter((row) => row.exchange === exchange) : screenerRows,
        meta: { count: screenerRows.length, source: 'live' },
      }));
    }
    if (url.pathname.endsWith('/alerts/insider')) return route.fulfill(json([]));
    if (url.pathname.endsWith('/market/freshness')) {
      return route.fulfill(json({ overall: 'fresh', buckets: [] }));
    }
    return route.fulfill(json({ data: [], count: 0 }));
  });
});

test('renders the dashboard and searches a ticker', async ({ page }) => {
  const [liveness, readiness] = await Promise.all([
    page.request.get('http://127.0.0.1:8000/live'),
    page.request.get('http://127.0.0.1:8000/ready'),
  ]);
  expect(liveness.ok()).toBeTruthy();
  expect(readiness.ok()).toBeTruthy();

  await openDashboard(page);

  await expect(page.getByText('Start with a suggested layout')).toBeVisible();
  await page.getByRole('button', { name: 'Open symbol search and command palette' }).click();
  await page.getByRole('combobox', { name: 'Command palette search' }).fill('VCB');
  await expect(page.getByRole('option', { name: /VCB.*Vietcombank/i })).toBeVisible();
});

test('filters screener results', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: 'VniBB Screener' }).click();

  await expect(page.getByRole('button', { name: 'View VCB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View SHS' })).toBeVisible();

  const filter = page.getByRole('textbox', { name: 'Filter screener results' });
  await filter.fill('VCB');
  await expect(filter).toHaveValue('VCB');
  await expect(page.getByRole('button', { name: 'View VCB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View SHS' })).not.toBeVisible();
});
