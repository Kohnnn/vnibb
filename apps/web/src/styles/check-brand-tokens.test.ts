import { readFileSync, readdirSync } from "node:fs";
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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

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
    // The colorblind remap is a direction-colour mode, not a second light
    // palette; its values are contrast-checked in their own block below.
    const paletteOnly = globals.slice(0, globals.indexOf(":root[data-color-mode='colorblind']"));
    expect(paletteOnly).not.toMatch(/^\s*--color-(text|bg|border|accent|positive|negative)-[a-z]+:\s*#/m);
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
    // The class and its alias were deleted in #197; nothing may reintroduce them.
    expect(all).not.toContain("--glass-widget-bg");
    expect(all).not.toContain(".glass-widget");
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

describe("root attribute ownership (#202)", () => {
  // Two providers used to write the same four attributes, so which value won
  // depended on mount order and a test could agree with either writer. There is
  // exactly one React owner now: the boot script in layout.tsx (first paint)
  // plus UiPreferencesContext (after hydration).
  const contextsDir = join(appDir, "..", "contexts");
  const writers = (attribute: string) => {
    // `setAttribute` calls in this codebase wrap onto the next line.
    const call = new RegExp(`setAttribute\\(\\s*'${attribute}'`);
    return walk(contextsDir)
      .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
      .filter((file) => call.test(readFileSync(file, "utf8")));
  };

  it.each(["data-density", "data-chart-style", "data-reduce-effects", "data-color-mode"])(
    "has a single React writer for %s",
    (attribute) => {
      const owners = writers(attribute).map((file) => file.slice(contextsDir.length + 1));
      expect(owners).toEqual(["UiPreferencesContext.tsx"]);
    },
  );

  it("leaves data-theme to ThemeContext alone", () => {
    const appContext = readFileSync(join(contextsDir, "AppContext.tsx"), "utf8");
    expect(appContext).not.toContain("setAttribute('data-theme'");
  });
});

describe("colorblind direction colours (#197 a11y)", () => {
  // Contrast is computed from the declared values, not trusted to comments.
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const block = (selector: string) => {
    const start = globals.indexOf(selector);
    const open = globals.indexOf("{", start);
    return globals.slice(open, globals.indexOf("\n}", open));
  };
  const darkCb = block(":root[data-color-mode='colorblind'] {");
  const lightCb = block(":root[data-color-mode='colorblind'][data-theme='light']");

  it("meets 4.5:1 in dark and light, on every surface of that theme", () => {
    const cases: Array<[string, string[], string[]]> = [
      [darkCb, ["#0A0E17", "#111827", "#12121A"], ["--color-positive", "--color-negative"]],
      [lightCb, ["#FFFFFF", "#F2F4F7", "#E8ECF1"], ["--color-positive", "--color-negative"]],
    ];
    for (const [cb, surfaces, names] of cases) {
      for (const name of names) {
        const value = tokenValue(cb, name);
        expect(value).toMatch(/^#[0-9A-F]{6}$/);
        for (const surface of surfaces) {
          expect(contrast(value, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps the light override scoped to light selectors only", () => {
    // Guard against the pre-#197 bug where a `:root.light[...]` variant never matched.
    expect(globals).toMatch(/:root\[data-color-mode='colorblind'\]\.light/);
    expect(globals).toMatch(/html\[data-color-mode='colorblind'\]\[data-theme='light'\]/);
  });
});

describe("probability-band and loss-mode remap (brand §13)", () => {
  it("defines every --cb-* token the prediction UI consumes", () => {
    // Regression: `var(--cb-positive, #34d399)` fallbacks always won because
    // the custom properties were referenced but never declared.
    for (const name of ["--cb-positive", "--cb-warning", "--cb-negative"]) {
      expect(tokenValue(tokens, name)).not.toBe("");
    }
  });

  it("leaves no raw palette class for the colorblind mode to remap", () => {
    // The swap works because colour comes from tokens. The old emerald/red
    // class overrides existed only to patch markup that bypassed them; every
    // component now uses tokens, so no raw palette class may return.
    const rawPalette = /\b(?:text|bg|border|ring|fill|stroke)-(?:emerald|green|red|rose|amber|cyan|blue|violet|purple|fuchsia|orange)-\d{2,3}\b/;
    for (const dir of ["components", "app", "hooks", "lib"]) {
      const root = join(stylesDir, "..", dir);
      for (const file of walk(root)) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
        const source = readFileSync(file, "utf8");
        expect([file, source.match(rawPalette)?.[0]]).toEqual([file, undefined]);
      }
    }
  });
});
