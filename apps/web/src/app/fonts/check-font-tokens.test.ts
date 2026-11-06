import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Font token resolution guard (ticket #195).
 *
 * Root cause it locks down: `:root` tokens in design-tokens.css reference the
 * next/font variables, so those variables MUST be declared on <html>, not on
 * <body>. Declaring them on <body> leaves `--font-family` empty at :root and
 * silently falls back to system sans.
 *
 * Run: pnpm --filter frontend test src/app/fonts/check-font-tokens.test.ts
 */
const appDir = join(__dirname, "..");
const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");
const tokens = readFileSync(join(appDir, "..", "styles", "design-tokens.css"), "utf8");

describe("font tokens", () => {
  // The JSX opening tags span several lines; anchor on the rendered markup
  // (the doc comment above also mentions <html>).
  const markup = layout.slice(layout.indexOf("return ("));
  const htmlTag = markup.match(/<html\b[^>]*>/)?.[0] ?? "";
  const bodyTag = markup.match(/<body\b[^>]*>/)?.[0] ?? "";

  it("mounts the next/font variables on <html>, where :root tokens resolve", () => {
    expect(htmlTag).toContain("${inter.variable}");
    expect(htmlTag).toContain("${plexMono.variable}");
    expect(bodyTag).not.toContain(".variable}");
  });

  it("loads Inter 400/500/600/700 and IBM Plex Mono 400", () => {
    for (const weight of ["400", "500", "600", "700"]) {
      expect(layout).toMatch(new RegExp(`Inter-[A-Za-z]+\\.ttf", weight: "${weight}"`));
    }
    expect(layout).toContain("IBMPlexMono-Regular.ttf");
    expect(layout).toContain('display: "swap"');
  });

  it("keeps the whole fallback list inside var()", () => {
    // A missing custom property is guaranteed-invalid at computed-value time and
    // voids the ENTIRE declaration, so anything after the var() comma list dies
    // with it. The fallback stack must therefore be the var() argument itself.
    // (jsdom does not substitute var(), so the behavioral proof lives in the
    // browser check: brand-notes/195-fonts.md.)
    const family = tokens.match(/--font-family:\s*([^;]+);/)?.[1].trim() ?? "";
    const mono = tokens.match(/--font-mono:\s*([^;]+);/)?.[1].trim() ?? "";
    expect(family).toMatch(/^var\(--font-inter,\s*'Inter',\s*-apple-system,.*sans-serif\)$/);
    expect(mono).toMatch(/^var\(--font-plex-mono,\s*'IBM Plex Mono',\s*'JetBrains Mono',.*monospace\)$/);
  });

  it("has no Geist references left", () => {
    expect(layout + tokens).not.toMatch(/geist/i);
  });
});
