import { expect, test, type Page } from '@playwright/test';

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function mount(page: Page, widgets: Array<{ type: string }>) {
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'VniBB walkthrough' }), async (d) => {
    await d.getByRole('button', { name: 'Close walkthrough' }).click();
  });
  await page.addInitScript((mounted) => {
    localStorage.setItem('vnibb-dashboard-version', 'v74');
    localStorage.setItem('vnibb_migration_version', '27');
    localStorage.setItem('vnibb-dashboard-storage-commit', 'committed');
    localStorage.setItem('vnibb_folders', JSON.stringify([{ id: 'f-v', name: 'V', order: 0, isExpanded: true }]));
    localStorage.setItem('vnibb_dashboards', JSON.stringify([{
      id: 'v-dash', name: 'V', folderId: 'f-v', order: 0, isDefault: false, isEditable: true,
      adminUnlocked: false, showGroupLabels: false,
      tabs: [{ id: 'v-tab', name: 'Overview', order: 0, dashboardId: 'v-dash',
        widgets: mounted.map((w, i) => ({ id: `v-w-${i}`, tabId: 'v-tab', type: w.type, config: {},
          layout: { i: `v-w-${i}`, x: 0, y: i * 8, w: 32, h: 8, minW: 8, minH: 4 } })) }],
      syncGroups: [], createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
    }]));
    localStorage.setItem('vnibb_user_preferences', JSON.stringify({ defaultTicker: 'VCB', defaultTab: 'fundamentals' }));
    localStorage.setItem('vnibb-dashboard-last-view', JSON.stringify({ activeDashboardId: 'v-dash', lastActiveTabIdByDashboard: { 'v-dash': 'v-tab' } }));
  }, widgets);
}

const SECTORS = [
  { sector: 'banking', sectorName: 'Ngân hàng', sectorNameEn: 'Banking', changePct: 3.4, topGainer: { symbol: 'VCB', price: 92000, changePct: 1.2 }, topLoser: { symbol: 'STB', price: 30000, changePct: -0.8 }, totalStocks: 27, stocks: [] },
  { sector: 'technology', sectorName: 'Công nghệ', sectorNameEn: 'Technology', changePct: 1.8, totalStocks: 12, stocks: [] },
  { sector: 'realestate', sectorName: 'Bất động sản', sectorNameEn: 'Real Estate', changePct: 0, totalStocks: 40, stocks: [] },
  { sector: 'steel', sectorName: 'Thép', sectorNameEn: 'Steel', changePct: -1.1, totalStocks: 9, stocks: [] },
  { sector: 'retail', sectorName: 'Bán lẻ', sectorNameEn: 'Retail', changePct: -3.6, totalStocks: 14, stocks: [] },
  { sector: 'energy', sectorName: 'Năng lượng', sectorNameEn: 'Energy', changePct: null, totalStocks: 8, stocks: [] },
];

test('populated widget surfaces in both themes', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.includes('/sector-performance')) return route.fulfill(json({ count: SECTORS.length, data: SECTORS }));
    if (p.includes('/market/heatmap')) {
      return route.fulfill(json({ count: 6, group_by: 'sector', color_metric: 'change_pct', size_metric: 'volume',
        cached: false, updated_at: '2026-11-03T07:00:00Z', price_updated_at: '2026-11-03T07:00:00Z', constituents_as_of: '2026-11-03',
        sectors: [['Banking', 3.4], ['Technology', 1.8], ['RealEstate', 0], ['Steel', -1.1], ['Retail', -3.6], ['Energy', null]].map(([n, c]) => ({
          sector: n as string, total_market_cap: null, total_size_value: 2000, cap_count: 0,
          avg_change_pct: c as number, stock_count: 2,
          stocks: [`${(n as string).slice(0, 2).toUpperCase()}A`, `${(n as string).slice(0, 2).toUpperCase()}B`].map((s) => ({
            symbol: s, name: s, sector: n, industry: n, market_cap: null, market_cap_provenance: null,
            size_value: 1000, price: 100, change: c, change_pct: c, volume: 1000 })),
        })) }));
    }
    if (p.endsWith('/market/indices') || p.includes('/market/overview'))
      return route.fulfill(json({ data: [
        { index_name: 'VN-INDEX', current_value: 1285.4, change_pct: 1.25 },
        { index_name: 'HNX-INDEX', current_value: 232.1, change_pct: 0 },
        { index_name: 'UPCOM-INDEX', current_value: 92.4, change_pct: -0.5 },
        { index_name: 'VN30', current_value: 1310.2, change_pct: null },
      ] }));
    if (p.includes('/insider/block-trades')) return route.fulfill(json([
      { id: 1, symbol: 'VCB', side: 'BUY', value: 42e9, quantity: 1000, price: 92000, trade_time: '2026-11-03T06:00:00Z', is_foreign: true, is_proprietary: false },
      { id: 2, symbol: 'FPT', side: 'SELL', value: 31e9, quantity: 500, price: 62000, trade_time: '2026-11-03T05:00:00Z', is_foreign: false, is_proprietary: false },
      { id: 3, symbol: 'HPG', side: null, value: 27e9, quantity: 800, price: 28000, trade_time: '2026-11-03T04:00:00Z', is_foreign: false, is_proprietary: true },
    ]));
    if (p.includes('/market/freshness')) return route.fulfill(json({ timestamp: '2026-11-03T07:00:00Z', overall: 'fresh', buckets: [{ label: 'Prices', status: 'fresh', reason: null, last_data_date: '2026-11-03', age_days: 0, detail: null, scope: 'hose_quotes' }] }));
    if (p.includes('/news/feed')) return route.fulfill(json({ articles: [] }));
    if (p.includes('/system-layouts')) return route.fulfill(json({ data: [] }));
    if (p.endsWith('/search/tickers')) return route.continue();
    return route.fulfill(json({ data: [], count: 0 }));
  });

  await mount(page, [{ type: 'sector_performance' }, { type: 'index_comparison' }, { type: 'big_flow_monitor' }]);
  for (const theme of ['light', 'dark'] as const) {
    await page.goto(`/dashboard?dashboard=v-dash&tab=v-tab&t=${theme}`);
    await page.evaluate((t) => localStorage.setItem('vnibb-theme', t), theme);
    await page.reload();
    await expect(page.locator('[data-widget-id]').first()).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: '[aria-label="VniBB walkthrough"] { display: none !important; }' });
    await page.evaluate(() => {
      document.querySelectorAll('[aria-label="VniBB walkthrough"]').forEach((el) => {
        (el.parentElement as HTMLElement | null)?.style.setProperty('display', 'none');
      });
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `/tmp/final-${theme}.png` });
  }
});
