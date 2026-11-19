import { expect, test, type Page } from '@playwright/test';
import {
  CURRENT_MIGRATION_VERSION,
  CURRENT_STORAGE_VERSION,
  DASHBOARD_STORAGE_COMMIT_KEY,
  FOLDERS_KEY,
  INITIAL_FOLDER_ID,
  MIGRATION_VERSION_KEY,
  STORAGE_KEY,
  STORAGE_VERSION_KEY,
  TECHNICAL_DASHBOARD_ID,
} from '../src/contexts/DashboardContext/constants';
import type { Dashboard, SystemDashboardTemplateListResponse } from '../src/types/dashboard';

const stamp = '2026-11-18T07:00:00Z';
const savedNote = 'Preserve this saved workspace.';
const publishedNote = 'Preserve this published layout.';
const savedTab = 'qa-saved-scan-tab';
const publishedTab = 'qa-published-scan-tab';

const original = {
  id: 'qa-saved-scan', name: 'Saved Market Scan Workspace', folderId: 'qa-folder', order: 0,
  isDefault: false, isEditable: false, showGroupLabels: false,
  syncGroups: [], createdAt: stamp, updatedAt: stamp,
  tabs: [
    {
      id: savedTab, name: 'Market Scan', order: 0,
      widgets: [{
        id: 'qa-note', tabId: savedTab, type: 'notes',
        config: { notesBySymbol: { FPT: savedNote } },
        layout: { i: 'qa-note', x: 2, y: 0, w: 11, h: 8, minW: 4, minH: 4 },
      }],
    },
    { id: 'qa-scan-entry', name: 'Scan Entry', order: 1, widgets: [] },
  ],
} satisfies Dashboard;

const published = {
  ...original,
  id: TECHNICAL_DASHBOARD_ID, name: 'Technical', folderId: INITIAL_FOLDER_ID, isDefault: true,
  tabs: [{
    id: publishedTab, name: 'Market Scan', order: 0,
    widgets: [{
      id: 'qa-published-note', tabId: publishedTab, type: 'notes',
      config: { notesBySymbol: { FPT: publishedNote } },
      layout: { i: 'qa-published-note', x: 0, y: 0, w: 12, h: 8 },
    }],
  }],
} satisfies Dashboard;
const publication = {
  count: 1,
  data: [{ dashboard_key: 'technical', status: 'published', version: 1, dashboard: published, updated_at: stamp }],
} satisfies SystemDashboardTemplateListResponse;

const headline = {
  id: 'market-brief', title: 'Vietnam market briefing across all exchanges',
  source: 'Synthetic exchange desk', published_at: stamp, url: 'https://headlines.invalid/market-brief',
} as const;
const tileSelector = '[data-widget-focus="true"][data-widget-type]';
const originalUrl = `/dashboard?dashboard=${original.id}&tab=${savedTab}&symbol=FPT`;
const publishedUrl = `/dashboard?dashboard=${published.id}&tab=${publishedTab}&symbol=FPT`;
const apiOrigins = ['http://localhost:8000', 'http://127.0.0.1:8000'];

async function committedDashboards(page: Page, ready: { dashboardId: string; tabId: string }) {
  const snapshot = await page.waitForFunction(({ ready, storageKey, commitKey }) => {
    const serialized = localStorage.getItem(storageKey);
    if (!serialized || localStorage.getItem(commitKey) !== 'committed') return null;
    const dashboards: Dashboard[] = JSON.parse(serialized);
    return dashboards.some(({ id, tabs }) => id === ready.dashboardId && tabs.some((tab) => tab.id === ready.tabId))
      ? dashboards
      : null;
  }, { ready, storageKey: STORAGE_KEY, commitKey: DASHBOARD_STORAGE_COMMIT_KEY }, { timeout: 12_000 });
  return snapshot.jsonValue();
}

test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Ho_Chi_Minh', contextOptions: { reducedMotion: 'reduce' } });

test('#272: applying Market Scan adds market-wide news without changing existing layouts', async ({ page, context, baseURL }, testInfo) => {
  const webOrigin = new URL(baseURL ?? 'http://localhost:3000').origin;
  let newsAvailable = false;
  const newsResponses: { query: string; status: number }[] = [];
  const dashboardWrites: string[] = [];
  await context.addInitScript(({ webOrigin, entries }) => {
    if (location.origin !== webOrigin) return;
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => true, configurable: true });
    if (sessionStorage.getItem('qa-scan-seeded')) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    sessionStorage.setItem('qa-scan-seeded', '1');
  }, {
    webOrigin,
    entries: {
      [STORAGE_VERSION_KEY]: CURRENT_STORAGE_VERSION,
      [MIGRATION_VERSION_KEY]: String(CURRENT_MIGRATION_VERSION),
      [DASHBOARD_STORAGE_COMMIT_KEY]: 'committed',
      [STORAGE_KEY]: JSON.stringify([original]),
      [FOLDERS_KEY]: JSON.stringify([{ id: 'qa-folder', name: 'QA', order: 0, isExpanded: true }]),
      'vnibb-user-preferences': JSON.stringify({
        defaultTicker: 'FPT', defaultTab: 'fundamentals',
        onboarding: { dashboardWalkthroughVersion: 4, dashboardWalkthroughDismissedVersion: 4 },
      }),
      'vnibb:whats-new-acknowledged:v1': 'v1.5.0',
    },
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  await context.route('**/*', (route) => {
    const { origin, pathname, searchParams } = new URL(route.request().url());
    const method = route.request().method();
    if (apiOrigins.includes(origin) && pathname.startsWith('/api/v1/')) {
      const headers = { 'access-control-allow-origin': webOrigin, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (method !== 'GET' && method !== 'HEAD') {
        if (pathname.startsWith('/api/v1/dashboard/') || pathname.startsWith('/api/v1/admin/system-layouts/')) {
          dashboardWrites.push(`${method} ${pathname}`);
        }
        return route.abort();
      }
      switch (pathname) {
        case '/api/v1/dashboard/system-layouts/published':
          return route.fulfill({ headers, json: publication });
        case '/api/v1/news/feed': {
          // No headline is available to a ticker-scoped request, even once the feed recovers.
          const marketWide = searchParams.get('mode') === 'all' && !searchParams.has('symbol');
          const status = marketWide ? (newsAvailable ? 200 : 503) : 422;
          newsResponses.push({ query: searchParams.toString(), status });
          return route.fulfill({ headers, status, json: status === 200 ? { mode: 'all', articles: [headline] } : {} });
        }
        case '/api/v1/market/freshness':
          return route.fulfill({ headers, json: { timestamp: stamp, overall: 'fresh', buckets: [] } });
        case '/api/v1/alerts/insider':
          return route.fulfill({ headers, json: [] });
        default:
          return route.fulfill({ headers, json: { data: [], count: 0 } });
      }
    }
    if (origin === webOrigin && (method === 'GET' || method === 'HEAD') && (
      pathname === '/dashboard' || pathname === '/api/health' || pathname.startsWith('/_next/static/') || pathname.startsWith('/__nextjs_font/')
    )) return route.continue();
    return route.abort();
  });

  await page.goto(originalUrl);
  const release = { dashboardId: published.id, tabId: publishedTab };
  const before = await committedDashboards(page, release);
  expect(before?.find(({ id }) => id === original.id)?.tabs).toEqual(original.tabs);
  expect(before?.find(({ id }) => id === published.id)?.tabs).toEqual(published.tabs);

  const scanEntry = page.getByRole('button', { name: 'Scan Entry tab', exact: true });
  const scanStarter = page.getByRole('main').getByRole('button', { name: /^Market Scan\b/ }).and(page.locator('button'));
  await scanEntry.click();
  await scanStarter.click();
  await page.waitForURL(({ searchParams }) => {
    const dashboardId = searchParams.get('dashboard');
    const tabId = searchParams.get('tab');
    return Boolean(dashboardId && dashboardId !== original.id && tabId && tabId !== 'qa-scan-entry');
  });
  await expect(page.getByRole('button', { name: /^Market Scan tab\b/ })).toBeVisible();
  const applied = new URL(page.url()).searchParams;

  const tiles = page.locator(tileSelector);
  await expect(tiles).toHaveCount(6);
  const news = tiles.and(page.locator('[data-widget-type="market_news"]'));
  await expect(news).toHaveAttribute('data-widget-symbol', 'FPT');
  const article = news.getByRole('link', { name: new RegExp(headline.title) });
  const retry = news.getByRole('button', { name: 'Try Again', exact: true });
  await expect(retry).toBeEnabled({ timeout: 20_000 });
  expect(newsResponses).toContainEqual(expect.objectContaining({ status: 503 }));
  await expect(article).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  // Scroll the page to the tile, not its inner list. Both the outage and its action should fit together.
  await news.scrollIntoViewIfNeeded();
  await expect(news.getByText('Connection Failed', { exact: true })).toBeInViewport({ ratio: 0.99 });
  await expect(retry).toBeInViewport({ ratio: 0.99 });
  await testInfo.attach('news-unavailable', { body: await page.screenshot({ scale: 'css' }), contentType: 'image/png' });

  newsAvailable = true;
  await retry.click();
  await expect(article).toHaveAttribute('href', headline.url);
  await article.scrollIntoViewIfNeeded();
  await expect(article).toBeInViewport({ ratio: 0.9 });
  await expect(retry).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await testInfo.attach('news-populated', { body: await page.screenshot({ scale: 'css' }), contentType: 'image/png' });

  const rects = await tiles.evaluateAll((elements) => elements.map((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { type: element.getAttribute('data-widget-type'), left, right, top, bottom };
  }));
  await testInfo.attach('applied-grid', { body: JSON.stringify(rects, null, 2), contentType: 'application/json' });
  expect(rects.map(({ type }) => type).sort()).toEqual([
    'market_breadth', 'market_heatmap', 'market_news', 'market_overview', 'screener', 'top_movers',
  ]);
  for (const [index, rect] of rects.entries()) {
    expect(rect.right - rect.left, `${rect.type} width`).toBeGreaterThan(0);
    expect(rect.bottom - rect.top, `${rect.type} height`).toBeGreaterThan(0);
    for (const other of rects.slice(index + 1)) {
      const intersects = rect.left < other.right && other.left < rect.right && rect.top < other.bottom && other.top < rect.bottom;
      expect(intersects, `${rect.type} overlaps ${other.type}`).toBe(false);
    }
  }

  const dashboardId = applied.get('dashboard');
  const tabId = applied.get('tab');
  if (!dashboardId || !tabId) throw new Error('Opt-in did not route to a new workspace and tab.');
  const after = await committedDashboards(page, { dashboardId, tabId });
  const preserved = (dashboards: Dashboard[] | null) => ({
    saved: dashboards?.find(({ id }) => id === original.id),
    published: dashboards?.find(({ id }) => id === published.id),
  });
  expect(preserved(after)).toEqual(preserved(before));
  await testInfo.attach('preserved-layouts', {
    body: JSON.stringify({ before: preserved(before), after: preserved(after), appliedDashboard: dashboardId }, null, 2),
    contentType: 'application/json',
  });

  await page.goto(publishedUrl);
  await expect(page.getByRole('textbox', { name: 'Legacy notes' })).toHaveValue(publishedNote);
  await expect(page.locator(tileSelector)).toHaveCount(1);
  await page.goto(originalUrl);
  await expect(page.getByRole('textbox', { name: 'Legacy notes' })).toHaveValue(savedNote);
  await scanEntry.click();
  await expect(scanStarter).toBeVisible();
  await testInfo.attach('fixture-traffic', { body: JSON.stringify({ newsResponses, dashboardWrites }, null, 2), contentType: 'application/json' });
  expect(dashboardWrites).toEqual([]);
  for (const { query } of newsResponses) {
    const params = new URLSearchParams(query);
    expect(params.get('mode')).toBe('all');
    expect(params.has('symbol')).toBe(false);
  }
});
