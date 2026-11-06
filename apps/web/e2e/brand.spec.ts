import { expect, test } from '@playwright/test';

/**
 * #196 brand acceptance: the master wordmark renders at the native 2048:446
 * ratio with 5.5% clear space inside its white plate, at 390, 1024 and 1440 px,
 * in light and dark themes. Screenshots land in test-results/brand/.
 *
 * Run against a dev server on :3101:
 *   pnpm --filter frontend exec playwright test -c playwright.brand.config.ts
 */

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`wordmark plate keeps ratio and clear space at ${viewport.name}px (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((activeTheme) => {
        localStorage.setItem('vnibb-theme', activeTheme);
      }, theme);

      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      const image = page.locator('.vnibb-logo-plate img').first();
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', '/brand/vnibb-wordmark-master.svg');

      const metrics = await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        const plate = img.parentElement as HTMLElement;
        const imgRect = img.getBoundingClientRect();
        const plateRect = plate.getBoundingClientRect();
        return {
          imgWidth: imgRect.width,
          imgHeight: imgRect.height,
          padLeft: imgRect.left - plateRect.left,
          padTop: imgRect.top - plateRect.top,
          padRight: plateRect.right - imgRect.right,
          padBottom: plateRect.bottom - imgRect.bottom,
          plateBackground: getComputedStyle(plate).backgroundColor,
        };
      });

      // Native ratio 2048:446, no stretch.
      expect(metrics.imgWidth / metrics.imgHeight).toBeCloseTo(2048 / 446, 1);
      // Screen minimum for the visible wordmark.
      expect(metrics.imgWidth).toBeGreaterThanOrEqual(80);
      // Clear space X = 5.5% of displayed width on every side.
      const x = metrics.imgWidth * 0.055;
      for (const pad of [metrics.padLeft, metrics.padTop, metrics.padRight, metrics.padBottom]) {
        expect(pad).toBeGreaterThanOrEqual(x - 0.5);
      }
      // White plate on both themes.
      expect(metrics.plateBackground).toBe('rgb(255, 255, 255)');

      await page.screenshot({
        path: `test-results/brand/login-${viewport.name}-${theme}.png`,
        fullPage: false,
      });
    });
  }
}

test('mobile header shows a visible brand link at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const brand = page.getByRole('link', { name: 'VniBB home' });
  await expect(brand).toBeVisible();
  const box = await brand.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(80);
  await page.screenshot({ path: 'test-results/brand/dashboard-390-header.png' });
});
