/**
 * Contract between a canvas chart and the PNG exporter.
 *
 * A canvas bakes its colours into its own bitmap, so it is the only component
 * that can produce a light rendering of itself. The exporter themes an
 * html2canvas clone light and asks each live chart for its own light bitmap
 * there; the chart restores itself before returning and the live root keeps the
 * user's theme.
 */
export const CHART_CAPTURE_EVENT = 'vnibb:capture-light-chart';

/** Marks the element a chart registered its capture listener on. */
export const LIGHT_CAPTURE_ATTR = 'data-light-chart-capture';

/** Tokens a light chart rendering reads from the light cascade. */
const LIGHT_CAPTURE_TOKENS = [
  '--bg-primary',
  '--bg-secondary',
  '--text-muted',
  '--border-color',
  '--border-subtle',
  '--color-positive',
  '--color-negative',
  '--chart-blue',
  '--chart-event-dividend',
  '--chart-event-split',
  '--chart-event-rights',
] as const;

export interface ChartLightCaptureDetail {
  /** Light-theme value of a CSS custom property, e.g. `--color-positive`. */
  token: (name: string) => string;
  /** Set by the chart: a bitmap of the same chart rendered on light tokens. */
  canvas?: HTMLCanvasElement;
  /** Capture failure, because `dispatchEvent` cannot propagate an exception. */
  error?: unknown;
}

export interface LightCapturePlan {
  /** Opaque light surface behind the capture, in a parser-friendly syntax. */
  surface: string;
  /** One light bitmap per registered chart, in DOM order. */
  bitmaps: HTMLCanvasElement[];
}

function readLightTokens(root: HTMLElement): Record<string, string> {
  const view = root.ownerDocument.defaultView;
  if (!view) return {};
  const style = view.getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of LIGHT_CAPTURE_TOKENS) tokens[name] = style.getPropertyValue(name).trim();
  return tokens;
}

/**
 * Ask every registered *live* chart for its light rendering, using the light
 * tokens the clone resolves for `lightRoot`.
 *
 * The clone is the only colour source: html2canvas copies the page styles into
 * it and `onclone` marks it light, so the live root and the saved preference are
 * never restyled, not even for one frame.
 *
 * A chart that cannot produce its light bitmap aborts the export: substituting
 * the live dark canvas would silently contradict brand §14.
 */
export function prepareLightCapture(liveRoot: HTMLElement, lightRoot: HTMLElement): LightCapturePlan {
  const tokens = readLightTokens(lightRoot);
  // A clone without the palette would paint every chart colourless; fail loudly.
  if (!tokens['--bg-primary']) throw new Error('the light export palette is unavailable');

  const bitmaps = Array.from(liveRoot.querySelectorAll<HTMLElement>(`[${LIGHT_CAPTURE_ATTR}]`)).map((host) => {
    const detail: ChartLightCaptureDetail = { token: (name) => tokens[name] ?? '' };
    host.dispatchEvent(new CustomEvent<ChartLightCaptureDetail>(CHART_CAPTURE_EVENT, { detail }));
    const canvas = detail.canvas;
    if (detail.error || !canvas || !canvas.width || !canvas.height) {
      // `cause` keeps the chart's own message (missing token, refused
      // screenshot); the message itself is what the export toast shows, so a
      // bare "refused" would leave the user without the actual problem.
      const reason = detail.error instanceof Error && detail.error.message ? `: ${detail.error.message}` : '';
      throw new Error(`A chart could not be re-rendered for a light export${reason}`, { cause: detail.error });
    }
    return canvas;
  });

  return { surface: tokens['--bg-primary'], bitmaps };
}
