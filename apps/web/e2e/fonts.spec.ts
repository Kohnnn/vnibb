import { test, expect } from '@playwright/test'

/**
 * Font token resolution guard (ticket #195).
 *
 * jsdom does not substitute var(), so the guaranteed-invalid-at-computed-value
 * behavior can only be proven in a real engine. A missing custom property voids
 * the WHOLE declaration, so the entire fallback stack must be the var() argument.
 */
test('root font tokens resolve to Inter / IBM Plex Mono and survive a missing variable', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => document.fonts.ready)

  const resolved = await page.evaluate(async () => {
    const html = document.documentElement
    const root = getComputedStyle(html)

    const probe = (family: string) => {
      const el = document.createElement('div')
      el.textContent = 'x'
      el.style.cssText = `position:absolute;left:-9999px;font-size:16px;font-family:${family}`
      document.body.appendChild(el)
      const value = getComputedStyle(el).fontFamily
      el.remove()
      return value
    }

    const withVars = { sans: probe('var(--font-family)'), mono: probe('var(--font-mono)') }

    // Simulate the next/font variables being absent (invalid at computed-value time).
    html.style.setProperty('--font-inter', 'initial')
    html.style.setProperty('--font-plex-mono', 'initial')
    const withoutVars = {
      token: getComputedStyle(html).getPropertyValue('--font-family').trim(),
      sans: probe('var(--font-family)'),
      mono: probe('var(--font-mono)'),
    }
    html.style.removeProperty('--font-inter')
    html.style.removeProperty('--font-plex-mono')

    return {
      rootFamily: root.getPropertyValue('--font-family').trim(),
      rootMono: root.getPropertyValue('--font-mono').trim(),
      body: getComputedStyle(document.body).fontFamily,
      withVars,
      withoutVars,
      restored: getComputedStyle(html).getPropertyValue('--font-family').trim(),
    }
  })

  expect(resolved.rootFamily).toMatch(/inter/i)
  expect(resolved.rootMono).toMatch(/plexMono|IBM Plex Mono/i)
  expect(resolved.body.split(',')[0].trim().replace(/["']/g, '')).toMatch(/^inter$/i)
  expect(resolved.withVars.sans.split(',')[0].trim().replace(/["']/g, '')).toMatch(/^inter$/i)
  expect(resolved.withVars.mono.split(',')[0].trim().replace(/["']/g, '')).toMatch(/^plexMono$/i)

  // Missing variable must not void the token: it falls back to the named stack.
  expect(resolved.withoutVars.token).not.toBe('')
  expect(resolved.withoutVars.sans.split(',')[0].trim().replace(/["']/g, '')).toMatch(/^Inter$/i)
  expect(resolved.withoutVars.mono).toMatch(/IBM Plex Mono/i)
  expect(resolved.restored).toMatch(/inter/i)
})

test('tabular numerals align in a real financial table', async ({ page }) => {
  // A rendered DenseFinancialTable (the app's financial statement table).
  await page.goto('/zz-font-fixture')
  await page.waitForSelector('td[data-type="number"] span.block', { timeout: 120_000 })

  const columns = await page.evaluate(() => {
    const byColumn: Record<number, { text: string; right: number; font: string; variant: string }[]> = {}
    for (const cell of document.querySelectorAll<HTMLTableCellElement>('td[data-type="number"]')) {
      const span = cell.querySelector('span.block')
      if (!span) continue
      const style = getComputedStyle(span)
      ;(byColumn[cell.cellIndex] ||= []).push({
        text: span.textContent?.trim() ?? '',
        right: span.getBoundingClientRect().right,
        font: style.fontFamily,
        variant: style.fontVariantNumeric,
      })
    }
    return Object.values(byColumn)
  })

  expect(columns.length).toBeGreaterThan(0)
  for (const rows of columns) {
    const digitRows = rows.filter((row) => /\d/.test(row.text))
    if (digitRows.length < 2) continue
    const edges = new Set(digitRows.map((row) => row.right.toFixed(2)))
    expect(digitRows.length, 'rows with digits').toBeGreaterThanOrEqual(3)
    expect(edges.size, `right edges of ${digitRows.map((r) => r.text).join(' | ')}`).toBe(1)
    expect(digitRows[0].variant).toContain('tabular-nums')
    expect(digitRows[0].font).toMatch(/inter/i)
  }
})
