import { expect, test } from '@playwright/test';

/**
 * #196 brand acceptance: the wordmark renders in the app at the native 2048:446
 * ratio with 5.5% clear space on a transparent field, at 320, 390, 1024 and
 * 1440 px, in light and dark themes. Screenshots land in test-results/brand/.
 *
 * Run against a dev server on :3101:
 *   pnpm --filter frontend exec playwright test -c playwright.brand.config.ts
 */

const VIEWPORTS = [
  { name: '320', width: 320, height: 720 },
  { name: '390', width: 390, height: 844 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const THEMES = [
  { name: 'light', ink: 'rgb(10, 10, 10)' },
  { name: 'dark', ink: 'rgb(249, 250, 251)' },
] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`wordmark keeps ratio, clear space and ${theme.name} ink at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((activeTheme) => {
        localStorage.setItem('vnibb-theme', activeTheme);
      }, theme.name);

      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      const logo = page.locator('[data-brand-wordmark]').first();
      await expect(logo).toBeVisible();

      const metrics = await logo.evaluate((element) => {
        const wordmark = element.firstElementChild as HTMLElement;
        const logoRect = element.getBoundingClientRect();
        const markRect = wordmark.getBoundingClientRect();
        const markStyle = getComputedStyle(wordmark);
        return {
          markWidth: markRect.width,
          markHeight: markRect.height,
          padLeft: markRect.left - logoRect.left,
          padTop: markRect.top - logoRect.top,
          padRight: logoRect.right - markRect.right,
          padBottom: logoRect.bottom - markRect.bottom,
          logoBackground: getComputedStyle(element).backgroundColor,
          ink: markStyle.backgroundColor,
          maskImage: markStyle.getPropertyValue('mask-image') || markStyle.getPropertyValue('-webkit-mask-image'),
        };
      });

      // Native ratio 2048:446, no stretch.
      expect(metrics.markWidth / metrics.markHeight).toBeCloseTo(2048 / 446, 1);
      // Screen minimum for the visible wordmark.
      expect(metrics.markWidth).toBeGreaterThanOrEqual(80);
      // Clear space X = 5.5% of displayed width on every side.
      const x = metrics.markWidth * 0.055;
      for (const pad of [metrics.padLeft, metrics.padTop, metrics.padRight, metrics.padBottom]) {
        expect(pad).toBeGreaterThanOrEqual(x - 0.5);
      }
      // No plate, and the master artwork is the mask rather than a recolour.
      expect(metrics.logoBackground).toBe('rgba(0, 0, 0, 0)');
      expect(metrics.maskImage).toContain('vnibb-wordmark-master.svg');
      // Theme-aware ink: Ink on Paper, near-white on the dark shell.
      expect(metrics.ink).toBe(theme.ink);

      // A resolved mask URL alone does not prove the artwork actually painted.
      const screenshot = await logo.screenshot();
      const inkPixels = await page.evaluate(async ({ encoded, ink }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const channels = ink.match(/\d+/g)!.map(Number);
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (channels.every((channel, index) => Math.abs(pixels[i + index] - channel) <= 2)) count++;
        }
        return count;
      }, { encoded: screenshot.toString('base64'), ink: theme.ink });
      expect(inkPixels).toBeGreaterThan(50);

      await page.screenshot({
        path: `test-results/brand/login-${viewport.name}-${theme.name}.png`,
        fullPage: false,
      });
    });
  }
}

for (const viewport of VIEWPORTS.filter((size) => size.width < 1024)) {
  test(`dashboard header wordmark stays visible, named, inside the viewport and sized when switching themes at ${viewport.name}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // A fresh browser profile auto-opens the dashboard walkthrough 240 ms after
    // mount, and its fixed z-[140] backdrop swallows the Display settings click.
    // Seed it as dismissed, the same way brand-states.spec.ts does.
    await page.addInitScript(() => {
      localStorage.setItem('vnibb-theme', 'dark');
      localStorage.setItem('vnibb-user-preferences', JSON.stringify({
        onboarding: { dashboardWalkthroughVersion: 4, dashboardWalkthroughDismissedVersion: 4 },
      }));
    });
    await page.goto('/dashboard');
    const brand = page.getByRole('link', { name: 'VniBB home' });
    const logo = brand.locator('[data-brand-wordmark]');
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAccessibleName('VniBB home');
    await page.getByRole('button', { name: 'Open menu' }).focus();
    await page.keyboard.press('Tab');
    await expect(brand).toBeFocused();
    await expect(logo.locator('span')).toHaveCSS('background-color', 'rgb(249, 250, 251)');
    const before = await logo.boundingBox();
    expect(before?.width ?? 0).toBeGreaterThan(80);
    // The compact header must not push the wordmark past the right edge.
    expect(before!.x + before!.width).toBeLessThanOrEqual(viewport.width);

    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('menuitem', { name: 'light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(brand).toHaveAccessibleName('VniBB home');
    await page.getByRole('button', { name: 'Open menu' }).focus();
    await page.keyboard.press('Tab');
    await expect(brand).toBeFocused();
    await expect(logo.locator('span')).toHaveCSS('background-color', 'rgb(10, 10, 10)');
    const after = await logo.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    await page.screenshot({ path: `test-results/brand/dashboard-${viewport.name}-header.png` });
  });
}

test('wordmark follows system ink in forced-colors mode', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Forced-colors emulation is checked in Chromium');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/login');
  const mark = page.locator('[data-brand-wordmark] span');
  await expect(mark).toBeVisible();
  const canvasText = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'CanvasText';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(mark).toHaveCSS('background-color', canvasText);
});
