import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Brand token + theme bridge guard (ticket #197).
 *
 * Locks down the VniBB v1.1 light palette, the single-source rule (light
 * values live in design-tokens.css under the selectors the pre-hydration
 * script sets), the retired glass/glow/16 px-radius tokens, neutral system
 * states, and the control/focus token contract.
 *
 * Run: pnpm --filter frontend test src/styles/check-brand-tokens.test.ts
 */
const stylesDir = __dirname;
const appDir = join(stylesDir, "..", "app");
const tokens = readFileSync(join(stylesDir, "design-tokens.css"), "utf8");
const globals = readFileSync(join(appDir, "globals.css"), "utf8");
const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");
const accessibility = readFileSync(join(stylesDir, "accessibility.css"), "utf8");

const lightBlock = (() => {
  // Comment-free slice: find the light selector, then its opening brace and the
  // first closing brace at column 0 (declarations are indented).
  const start = tokens.indexOf("\nhtml[data-theme=\"light\"]");
  const open = tokens.indexOf("{", start);
  const close = tokens.indexOf("\n}", open);
  return tokens.slice(open, close);
})();
const tokenValue = (block: string, name: string) =>
  block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim().toUpperCase() ?? "";

describe("brand light palette", () => {
  it("uses the v1.1 pack values", () => {
    expect(tokenValue(lightBlock, "--color-text-primary")).toBe("#0A0A0A");
    expect(tokenValue(lightBlock, "--color-bg-primary")).toBe("#FFFFFF");
    expect(tokenValue(lightBlock, "--color-text-secondary")).toBe("#5B6573");
    expect(tokenValue(lightBlock, "--color-border-default")).toBe("#D9DDE3");
    expect(tokenValue(lightBlock, "--color-accent-primary")).toBe("#0B3D91");
    expect(tokenValue(lightBlock, "--color-positive")).toBe("#1E7B4F");
    expect(tokenValue(lightBlock, "--color-negative")).toBe("#B3261E");
  });

  it("marks essential control boundaries with Slate, not Rule", () => {
    expect(tokenValue(lightBlock, "--color-border-strong")).toBe("#5B6573");
  });

  it("is reached by the selectors the pre-hydration script sets", () => {
    for (const selector of ['html[data-theme="light"]', "html.light"]) {
      expect(tokens).toContain(selector);
    }
    expect(layout).toContain("setAttribute('data-theme', resolved)");
    expect(layout).toContain("classList.add(resolved)");
  });

  it("adds no second brand layer", () => {
    expect(tokens + globals).not.toContain("data-vnibb-brand");
  });

  it("keeps dark values untouched", () => {
    const root = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("html.light"));
    expect(tokenValue(root, "--color-bg-primary")).toBe("#0A0E17");
    expect(tokenValue(root, "--color-text-primary")).toBe("#F9FAFB");
    expect(tokenValue(root, "--color-accent-primary")).toBe("#3B82F6");
    expect(tokenValue(root, "--color-positive")).toBe("#2EE06A");
    expect(tokenValue(root, "--color-negative")).toBe("#FF5A5A");
  });

  it("defines the light palette once (globals only re-aliases)", () => {
    expect(globals).not.toMatch(/^\s*--color-(text|bg|border|accent|positive|negative)-[a-z]+:\s*#/m);
  });
});

describe("system states", () => {
  it("never use red/green for saved/loading/warning/failed", () => {
    for (const block of [tokens, lightBlock]) {
      for (const name of ["--color-success", "--color-warning", "--color-error", "--color-info"]) {
        expect(tokenValue(block, name)).not.toMatch(/^#[0-9A-F]{6}$/);
      }
    }
    expect(globals).not.toMatch(/--color-warning:\s*#/);
  });
});

describe("retired decoration", () => {
  it("has no glass, glow or 16 px widget radius", () => {
    const all = tokens + globals;
    expect(all).not.toContain("--widget-bg-glass");
    expect(all).not.toContain("--widget-shadow-glow");
    expect(all).not.toMatch(/--widget-radius:\s*16px/);
    expect(tokens).toMatch(/--widget-radius:\s*4px/);
    expect(globals).not.toContain("border-radius: 16px");
    expect(globals).not.toContain("@keyframes widget-glow");
  });

  it("keeps the reduce-effects escape hatch on the html root", () => {
    expect(globals).toContain('html[data-reduce-effects="true"] .widget-card-premium');
    expect(layout).toContain("data-reduce-effects");
    expect(layout).toContain("data-color-mode");
  });
});

describe("controls and focus", () => {
  it("defines 36 px desktop controls and 44 px touch targets", () => {
    expect(tokenValue(tokens, "--control-height")).toBe("36PX");
    expect(tokenValue(tokens, "--touch-target-size")).toBe("44PX");
    expect(tokens).toMatch(/@media \(pointer: coarse\)[\s\S]*--control-height:\s*44px/);
  });

  it("keeps a visible 2 px focus ring with 2 px offset", () => {
    expect(tokenValue(tokens, "--focus-ring-width")).toBe("2PX");
    expect(tokenValue(tokens, "--focus-ring-offset")).toBe("2PX");
    expect(accessibility).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width/);
  });
});
