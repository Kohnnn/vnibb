import { chromium } from 'playwright';

const url = 'https://vnibb-web.vercel.app/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleMessages = [];
const failedRequests = [];
const responses = [];

page.on('console', (message) => {
  consoleMessages.push({ type: message.type(), text: message.text().slice(0, 500) });
});
page.on('requestfailed', (request) => {
  failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? 'unknown' });
});
page.on('response', (response) => {
  const responseUrl = response.url();
  if (responseUrl.includes('/api/') || response.status() >= 400) {
    responses.push({ url: responseUrl, status: response.status() });
  }
});

const start = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const domContentLoadedMs = Date.now() - start;
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
const totalMs = Date.now() - start;

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: Math.round(entry.startTime) }));
  return {
    title: document.title,
    bodyText: document.body.innerText.slice(0, 2000),
    navigation: nav ? {
      domContentLoadedEventEnd: Math.round(nav.domContentLoadedEventEnd),
      loadEventEnd: Math.round(nav.loadEventEnd),
      transferSize: nav.transferSize,
      decodedBodySize: nav.decodedBodySize,
    } : null,
    paint,
    widgetCount: document.querySelectorAll('[data-widget-id], [data-widget-type]').length,
  };
});

await page.screenshot({ path: 'output/playwright/vnibb-home.png', fullPage: true });
await browser.close();

console.log(JSON.stringify({
  url,
  domContentLoadedMs,
  totalMs,
  metrics,
  consoleMessages,
  failedRequests,
  apiResponses: responses.slice(0, 100),
}, null, 2));
