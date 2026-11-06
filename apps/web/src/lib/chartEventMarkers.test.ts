import { readFileSync } from 'fs';
import { join } from 'path';
import { buildChartEventMarkers } from './chartEventMarkers';

// Corporate-action markers are 10 px text drawn on the chart canvas, in both
// themes and inside the light PNG export. WCAG 1.4.3 wants 4.5:1 for text that
// size, and the marker hue is the only thing distinguishing the three kinds, so
// each token is checked against the surface of the theme that defines it.
const TOKEN_FILE = readFileSync(join(__dirname, '../styles/design-tokens.css'), 'utf8');

function tokenBlock(startPattern: RegExp): string {
  const start = TOKEN_FILE.search(startPattern);
  if (start < 0) throw new Error('theme block not found');
  const open = TOKEN_FILE.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < TOKEN_FILE.length; index += 1) {
    if (TOKEN_FILE[index] === '{') depth += 1;
    if (TOKEN_FILE[index] === '}') {
      depth -= 1;
      if (depth === 0) return TOKEN_FILE.slice(open, index);
    }
  }
  throw new Error('unterminated theme block');
}

function readToken(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${name} is not a hex value in this theme block`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const PRICE_ROWS = [{ time: '2026-10-05' }];

describe('chart event marker colours', () => {
  it('keeps every marker legible as a 10px label in both themes', () => {
    const markers = buildChartEventMarkers(
      [
        { symbol: 'FPT', action_category: 'dividend', effective_date: '2026-10-05' },
        { symbol: 'FPT', action_category: 'split', effective_date: '2026-10-05' },
        { symbol: 'FPT', action_subtype: 'rights_issue', effective_date: '2026-10-05' },
      ],
      PRICE_ROWS,
    );

    expect(markers.map((marker) => marker.category).sort()).toEqual(['dividend', 'rights', 'split']);

    const themes = [
      { name: 'dark', block: tokenBlock(/^:root\s*\{/m), surface: '#0a0e17' },
      { name: 'light', block: tokenBlock(/:root\[data-theme="light"\]/), surface: '#FFFFFF' },
    ];

    for (const theme of themes) {
      for (const marker of markers) {
        // A raw `var(...)` string reaches a canvas, which drops it entirely.
        expect(marker.color).toMatch(/^var\(--chart-event-\w+\)$/);
        const value = readToken(theme.block, marker.color.slice(4, -1));
        expect(contrast(value, theme.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
