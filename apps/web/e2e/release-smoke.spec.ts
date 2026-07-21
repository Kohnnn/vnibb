import { expect, test } from '@playwright/test';

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

test.beforeEach(async ({ page }) => {
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
      onboarding: { dashboardWalkthroughVersion: 3, dashboardWalkthroughDismissedVersion: 3 },
    }));
  });

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/search/tickers')) {
      await route.continue();
      return;
    }
    if (url.pathname.endsWith('/screener/')) {
      const exchange = url.searchParams.get('exchange');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: exchange ? screenerRows.filter((row) => row.exchange === exchange) : screenerRows,
          meta: { count: screenerRows.length, source: 'live' },
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/alerts/insider')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }
    if (url.pathname.endsWith('/market/freshness')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ overall: 'fresh', buckets: [] }),
      });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [], count: 0 }) });
  });
});

test('renders the dashboard and searches a ticker', async ({ page }) => {
  const [liveness, readiness] = await Promise.all([
    page.request.get('http://127.0.0.1:8000/live'),
    page.request.get('http://127.0.0.1:8000/ready'),
  ]);
  expect(liveness.ok()).toBeTruthy();
  expect(readiness.ok()).toBeTruthy();

  await page.goto('/dashboard');

  await expect(page.getByText('Start with a suggested layout')).toBeVisible();
  await page.getByRole('button', { name: 'Open symbol search and command palette' }).click();
  await page.getByRole('textbox', { name: 'Command palette search' }).fill('VCB');
  await expect(page.getByRole('button', { name: /VCB.*Vietcombank/i })).toBeVisible();
});

test('filters screener results', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'VNIBB Screener' }).click();

  await expect(page.getByText('VNIBB Screener Pro', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View VCB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View SHS' })).toBeVisible();

  const filter = page.getByRole('textbox', { name: 'Filter screener results' });
  await filter.fill('VCB');
  await expect(filter).toHaveValue('VCB');
  await expect(page.getByRole('button', { name: 'View VCB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View SHS' })).not.toBeVisible();
});
