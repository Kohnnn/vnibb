#!/usr/bin/env node
/**
 * Bounded, read-only live smoke for the published dashboard workspaces (#110).
 *
 * What it does
 *   - Opens /dashboard in one fresh isolated Chromium context (TLS validation
 *     on, no storageState, no user profile, no second profile).
 *   - Discovers the *current* published inventory from the rendered UI: the
 *     sidebar workspace items, then each workspace's tab bar. Nothing about
 *     workspace or tab counts is hardcoded. The bundled/persisted copy in
 *     localStorage is read only to report divergence from what is rendered.
 *   - Visits every workspace and every one of its child tabs twice:
 *       click  - in-app navigation (sidebar workspace item, then tab bar tab)
 *       direct - `?dashboard=<id>&tab=<id>` deep link
 *   - Records per-widget type + ready/pending/error/unavailable/unknown state
 *     with the observed text as evidence, plus console errors, page errors,
 *     failed requests and 4xx/5xx responses.
 *
 * What it does NOT do
 *   - No writes to localStorage/sessionStorage/cookies (the onboarding
 *     walkthrough overlay is reported, never dismissed — dismissing writes
 *     user preferences), no request mocking, no overlay dismissal.
 *   - No clicks on settings, backup, import, add/delete/rename/reorder or any
 *     other state-changing control; only workspace and tab navigation.
 *   - No auth headers are captured (only URLs and status codes); sensitive
 *     query params are redacted.
 *   - No claim about provider truth: a tab is never reported as a pass while
 *     any widget is pending/unknown.
 *
 * Warm-reload regression check (`--reload-check`)
 *   - After the inventory walk, picks one representative deferred tab from the
 *     discovered inventory (prefers a tab whose widget types are the heavy
 *     lazily-mounted ones), deep-links it, reloads the real page once, then
 *     samples widget bodies until the per-tab budget runs out.
 *   - Terminal verdict: a widget body still literally loading at the budget
 *     terminal is a FAIL (exit 3). A body that settled into an explicit
 *     unavailable/error/unknown state is an acceptable outcome, reported as
 *     such, because that is honest user-visible behaviour, not a stuck mount.
 *
 * Usage
 *   node scripts/qa-live-smoke.mjs --base-url https://vnibb-web.vercel.app --out report.json
 *   QA_BASE_URL=http://localhost:3100 node scripts/qa-live-smoke.mjs --out report.json
 *   node scripts/qa-live-smoke.mjs --base-url <url> --reload-check --out report.json
 *
 * Exit codes: 0 = run completed (read the report), 2 = target inaccessible,
 *             1 = script/runtime failure, 3 = warm-reload check failed.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const STORAGE_KEY = 'vnibb_dashboards';
const LAST_VIEW_KEY = 'vnibb-dashboard-last-view';

const ERROR_MARKERS = [
  'Failed to load data',
  'Something Went Wrong',
  'Connection Failed',
  'Request Timed Out',
  'Too Many Requests',
  'Authentication Required',
  'Access Denied',
  'Data Not Found',
  'Mixed Content Blocked',
];
const PENDING_MARKERS = [/^loading data\b/i, /^loading widget\b/i, /^loading\b/i];
// A user-visible timeout is a terminal error, not a still-loading state: the
// widget stopped waiting and offers a Retry control.
const TIMEOUT_MARKERS = [/loading timed out/i, /request timed out/i, /\btimed out\b/i];
const EMPTY_MARKERS = [/no data available/i, /\bunavailable\b/i, /\bno data\b/i, /not available/i, /no longer in your library/i];
const SENSITIVE_PARAM = /(token|secret|password|passwd|apikey|api_key|access_key|signature|sig|auth)/i;

// Heavy lazily-mounted widget types the warm-reload check prefers as its
// representative tab. This is a preference list for tab selection, not an
// expected-inventory assertion: if none of them is on screen the check falls
// back to the tab with the most rendered widgets.
const DEFERRED_WIDGET_TYPES = [
  'gap_analysis',
  'gap_fill_stats',
  'backtest_lab',
  'sweep_matrix',
  'quant_summary',
  'signal_summary',
  'market_breadth',
  'industry_bubble',
  'top_movers',
];

const USAGE = `Usage: node scripts/qa-live-smoke.mjs --base-url <url> [options]

  --base-url <url>       target origin (or QA_BASE_URL / BASE_URL env)
  --out <path>           write JSON report here; "-" prints to stdout (default -)
  --nav-timeout <ms>     page load / hydration budget (default 30000)
  --action-timeout <ms>  single click/keypress budget (default 8000)
  --settle <ms>          post-navigation settle before capture (default 1500)
  --tab-budget <ms>      total budget per tab, both passes (default 30000)
  --max-tabs <n>         stop after n tabs (default 20)
  --max-workspaces <n>   stop after n workspaces (default 8)
  --reload-check         add the warm-reload regression check (exit 3 on a
                         widget still loading at the budget terminal)
  --self-check           run the assert-based extraction/classification checks
                         in a real browser page before the walk; exit 1 on a
                         failed assertion (base-url optional with it)
  --headed               run headed (debugging only)
  --help                 show this help`;

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.QA_BASE_URL || process.env.BASE_URL || '',
    out: '-',
    navTimeout: 30000,
    actionTimeout: 8000,
    settle: 1500,
    tabBudget: 30000,
    maxTabs: 20,
    maxWorkspaces: 8,
    reloadCheck:false,
    selfCheck:false,
    headed:false,
    help:false,
  };
  const num = (name, raw) => {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--base-url') opts.baseUrl = next();
    else if (arg === '--out') opts.out = next();
    else if (arg === '--nav-timeout') opts.navTimeout = num(arg, next());
    else if (arg === '--action-timeout') opts.actionTimeout = num(arg, next());
    else if (arg === '--settle') opts.settle = num(arg, next());
    else if (arg === '--tab-budget') opts.tabBudget = num(arg, next());
    else if (arg === '--max-tabs') opts.maxTabs = num(arg, next());
    else if (arg === '--max-workspaces') opts.maxWorkspaces = num(arg, next());
    else if (arg === '--reload-check') opts.reloadCheck =true;
    else if (arg === '--self-check') opts.selfCheck =true;
    else if (arg === '--headed') opts.headed =true;
    else if (arg === '--help' || arg === '-h') opts.help =true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.help && !opts.selfCheck && !opts.baseUrl) throw new Error('missing --base-url (or QA_BASE_URL / BASE_URL)');
  return opts;
}

function redactUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return String(raw);
  }
}

const normalizeKey = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Classify one rendered widget cell from its observed DOM facts. */
function classifyCell(cell) {
  const text = cell.text;
  // Errors first: "Loading timed out" + Retry is a user-visible failure, and a
  // Retry control means the widget gave up, so neither may read as pending.
  const timeoutMarker = TIMEOUT_MARKERS.find((re) => re.test(text));
  const errorMarker =
    ERROR_MARKERS.find((marker) => text.includes(marker)) ??
    (timeoutMarker ? String(timeoutMarker) : null) ??
    (cell.retry ? 'retry control' : null);
  if (errorMarker) return { state: 'error', evidence: text, matched: errorMarker };
  // An empty/unavailable message only counts when the body shows no real
  // content: a rendered chart can contain the word "unavailable" in its own
  // labels, and that must not be reported as a terminal empty state.
  if (!cell.content) {
    const emptyMarker = EMPTY_MARKERS.find((re) => re.test(text));
    if (emptyMarker) return { state: 'unavailable', evidence: text, matched: String(emptyMarker) };
  }
  if (cell.spinner || cell.skeleton) {
    return { state: 'pending', evidence: text || 'loading indicator present', matched: cell.spinner ? 'spinner' : 'skeleton' };
  }
  const pendingMarker = PENDING_MARKERS.find((re) => re.test(text));
  if (pendingMarker) return { state: 'pending', evidence: text, matched: String(pendingMarker) };
  if (cell.content) {
    const evidence = cell.embed
      ? 'third-party embed present (contents not inspectable cross-origin)'
      : text || 'content element present';
    return { state: 'ready', evidence, matched: cell.embed ? 'iframe' : 'content element' };
  }
  return { state: 'unknown', evidence: text || 'no observable content', matched: null };
}

function summarizeWidgets(cells) {
  const widgets = cells.map((cell) => {
    const { state, evidence, matched } = classifyCell(cell);
    return { id: cell.id, type: cell.type, symbol: cell.symbol ?? null, state, matched, evidence: evidence.slice(0, 200) };
  });
  const states = { ready: 0, pending: 0, error: 0, unavailable: 0, unknown: 0 };
  for (const widget of widgets) states[widget.state] += 1;
  return { widgets, states };
}

/**
 * Body verdict never claims a data pass while anything is pending/unknown.
 * A terminal failure outranks an in-flight load, so error is checked first.
 */
function bodyVerdict(body, states) {
  if (body !== 'rendered') return body;
  if (states.error > 0) return 'error';
  if (states.pending > 0) return 'pending';
  if (states.ready > 0 && states.unavailable === 0 && states.unknown === 0) return 'ready';
  if (states.unavailable > 0 && states.ready === 0 && states.unknown === 0) return 'unavailable';
  if (states.unknown > 0) return 'unknown';
  return 'mixed';
}

async function readPersisted(page) {
  return page.evaluate(
    ([storageKey, lastViewKey]) => {
      const parse = (raw) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };
      return {
        dashboards: parse(window.localStorage.getItem(storageKey)) || [],
        lastView: parse(window.localStorage.getItem(lastViewKey)) || null,
      };
    },
    [STORAGE_KEY, LAST_VIEW_KEY],
  );
}

/** Everything observed about the current screen, in one round trip. */
async function captureRendered(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    // A chart-sized SVG is content; a 14-24px toolbar/empty-state icon is not.
    const hasLargeSvg = (root) =>
      Array.from(root.querySelectorAll('svg')).some((svg) => {
        const rect = svg.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 120;
      });
    const sidebar = document.querySelector('[data-tour="sidebar-workspaces"]');
    const workspaceItems = sidebar ? Array.from(sidebar.querySelectorAll('div[role="button"][draggable="true"]')) : [];
    const workspaces = workspaceItems.map((el) => {
      const nameEl = el.querySelector('span.truncate');
      return { name: norm(nameEl ? nameEl.textContent : el.innerText) };
    });
    const tabBar = document.querySelector('[data-tour="tab-bar"]');
    const tabEls = tabBar ? Array.from(tabBar.querySelectorAll('div[role="button"][aria-label]')) : [];
    const tabs = tabEls.map((el) => ({
      name: norm(el.getAttribute('aria-label')).replace(/ tab(\..*)?$/, ''),
      active: (el.className || '').split(/\s+/).includes('bg-[var(--bg-tertiary)]'),
    }));
    // Each cell renders a toolbar (title + icon-only SVG controls) above the
    // widget body, and the body host is the element whose id is the widget id
    // (see WidgetWrapper). Reading the whole cell made the toolbar title and
    // the toolbar's own SVG icons look like widget content, which hid a
    // literal "Loading widget..." Suspense fallback reading as ready.
    // Classify from the body only; when the body host is missing, fall back to
    // the cell text without any SVG-derived content signal.
    const cells = Array.from(document.querySelectorAll('[data-widget-id][data-widget-type]')).map((el) => {
      const id = el.getAttribute('data-widget-id');
      const body = id ? el.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      const scope = body ?? el;
      const cellText = norm(el.innerText);
      return {
        id,
        type: el.getAttribute('data-widget-type'),
        symbol: el.getAttribute('data-widget-symbol'),
        text: body ? norm(body.innerText) : cellText,
        cellText: cellText.slice(0, 200),
        textScope: body ? 'widget-body' : 'cell-fallback',
        spinner: Boolean(scope.querySelector('.animate-spin')),
        skeleton: Boolean(scope.querySelector('.animate-pulse')),
        // Substantial content only: a chart-sized SVG counts, the toolbar's
        // 14-24px icon SVGs and an empty-state icon do not.
        content: body
          ? Boolean(body.querySelector('canvas, table, img, [role="table"], iframe')) || hasLargeSvg(body)
          : Boolean(el.querySelector('canvas, table, img, [role="table"], iframe')),
        embed: Boolean(body && body.querySelector('iframe')),
        retry: Array.from(scope.querySelectorAll('button')).some((button) => /retry|try again/i.test(norm(button.textContent))),
      };
    });
    const overlays = Array.from(document.querySelectorAll('div.fixed.inset-0, [role="dialog"][aria-modal="true"]'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
      })
      .map((el) => ({ role: el.getAttribute('role'), label: el.getAttribute('aria-label') || norm(el.innerText).slice(0, 80) }));
    const bodyText = norm(document.body.innerText);
    const params = new URLSearchParams(location.search);
    return {
      url: location.pathname + location.search,
      urlDashboardId: params.get('dashboard'),
      urlTabId: params.get('tab'),
      workspaces,
      tabs,
      activeTabName: tabs.find((tab) => tab.active)?.name ?? null,
      cells,
      overlays,
      markers: {
        emptyTabStarter: bodyText.includes('Start with a suggested layout'),
        noTabsAvailable: /no tabs available/i.test(bodyText),
        workspaceUnavailable: bodyText.includes('Workspace unavailable'),
      },
    };
  });
}

/**
 * Assert-based self-check for the cell extraction + classification, run in a
 * real browser page. It builds the actual toolbar-above-body structure the app
 * renders (icon-only SVG controls + title, then the body host whose id is the
 * widget id) and asserts that a literal "Loading widget..." Suspense fallback
 * is never read as ready. No fixtures are mocked, no product code runs, and a
 * failed assertion exits non-zero.
 */
async function runSelfCheck(context) {
  const page = await context.newPage();
  const checks = [];
  const check = (name, actual, expected) => {
    checks.push({ name, expected, actual, ok: actual === expected });
  };
  const toolbar = (title) =>
    `<div class="relative flex min-h-9 min-w-0 shrink-0 items-center justify-between gap-1 border-b px-2 select-none">` +
    `<div class="flex items-center gap-1.5"><span title="${title}" aria-label="${title}">${title}</span></div>` +
    `<div class="flex shrink-0 items-center gap-1"><button aria-label="Refresh widget"><svg viewBox="0 0 24 24"></svg></button>` +
    `<button aria-label="Widget actions for ${title}"><svg viewBox="0 0 24 24"></svg></button></div></div>`;
  const body = (id, inner) => `<div id="${id}" class="relative min-h-0 flex-1 overflow-auto rounded-b-lg p-2">${inner}</div>`;
  const cell = (id, type, title, inner) =>
    `<div data-widget-id="${id}" data-widget-type="${type}" data-widget-symbol="VCI">` +
    `<div class="widget-card-premium" data-widget-id="${id}">${toolbar(title)}${inner === null ? '' : body(id, inner)}</div></div>`;

  await page.setContent(
    `<!doctype html><html><body>` +
      cell('w-loading', 'gap_analysis', 'Gap Analysis', '<div class="p-4">Loading widget...</div>') +
      cell('w-ready', 'momentum', 'Momentum', '<div>Ticker shared VCI</div><canvas></canvas>') +
      cell('w-error', 'volume_profile', 'Volume Profile', '<div>Connection Failed Network error.</div><button>Try Again</button>') +
      cell('w-empty', 'top_movers', 'Top Gainers/Losers', '<div>No data available</div>') +
      cell('w-skeleton', 'signal_summary', 'Signal Summary', '<div class="animate-pulse"><div class="h-3"></div></div>') +
      cell('w-toolbar-only', 'sweep_matrix', 'Sweep Matrix', null) +
      cell('w-chart-svg', 'price_chart', 'Price Chart', '<svg width="420" height="260"></svg><div>1D 1M 1Y Compare</div>') +
      cell('w-icon-empty', 'top_movers', 'Top Gainers/Losers', '<svg width="24" height="24"></svg><div>No data available</div>') +
      cell('w-embed', 'tradingview_screener', 'Screener', '<iframe title="embed" src="about:blank" width="320" height="240"></iframe>') +
      cell('w-word-unavailable', 'momentum', 'Momentum', '<canvas></canvas><div>Trailing window unavailable for this ticker</div>') +
      `</body></html>`,
  );

  const shot = await captureRendered(page);
  const byId = new Map(shot.cells.map((entry) => [entry.id, entry]));
  const stateOf = (id) => {
    const entry = byId.get(id);
    return entry ? classifyCell(entry).state : 'missing';
  };

  check('literal Suspense fallback is pending', stateOf('w-loading'), 'pending');
  check('canvas body is ready', stateOf('w-ready'), 'ready');
  check('network failure body is error', stateOf('w-error'), 'error');
  check('empty body is unavailable', stateOf('w-empty'), 'unavailable');
  check('skeleton body is pending', stateOf('w-skeleton'), 'pending');
  check('toolbar-only cell is never ready', stateOf('w-toolbar-only') === 'ready' ? 'ready' : 'not-ready', 'not-ready');
  check('loading cell was read from the body, not the cell', byId.get('w-loading')?.textScope, 'widget-body');
  check('toolbar text does not leak into the classified text', byId.get('w-loading')?.text, 'Loading widget...');
  check('chart-sized svg body is ready', stateOf('w-chart-svg'), 'ready');
  check('icon-only empty state is unavailable', stateOf('w-icon-empty'), 'unavailable');
  check('iframe embed body is ready', stateOf('w-embed'), 'ready');
  check('word "unavailable" next to real content is not an empty state', stateOf('w-word-unavailable'), 'ready');

  await page.close();
  return { checks, failed: checks.filter((entry) => !entry.ok).map((entry) => entry.name) };
}

/** Activate a control: real mouse click, else keyboard Enter, else DOM click. */
async function activate(locator, timeout, overlayNote) {
  const attempts = [];
  try {
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await locator.click({ timeout });
    return { ok:true, method: 'mouse', attempts, overlayNote };
  } catch (error) {
    attempts.push({ method: 'mouse', error: String(error?.message ?? error).slice(0, 200) });
  }
  try {
    await locator.press('Enter', { timeout });
    return { ok:true, method: 'keyboard-enter', attempts, overlayNote };
  } catch (error) {
    attempts.push({ method: 'keyboard-enter', error: String(error?.message ?? error).slice(0, 200) });
  }
  try {
    await locator.evaluate((el) => el.click());
    return { ok:true, method: 'dom-click', attempts, overlayNote };
  } catch (error) {
    attempts.push({ method: 'dom-click', error: String(error?.message ?? error).slice(0, 200) });
  }
  return { ok:false, method: null, attempts, overlayNote };
}

function pickActiveTabId(dashboards, lastView, dashboardId) {
  if (!lastView || lastView.activeDashboardId !== dashboardId) return null;
  return lastView.lastActiveTabIdByDashboard?.[dashboardId] ?? null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const base = opts.baseUrl.replace(/\/+$/, '');
  const startedAt = new Date().toISOString();

  const report = {
    schema: 'vnibb.qa.live-smoke/1',
    ticket: '#110',
    mode: 'read-only',
    startedAt,
    baseUrl: base,
    limits: {
      navTimeoutMs: opts.navTimeout,
      actionTimeoutMs: opts.actionTimeout,
      settleMs: opts.settle,
      tabBudgetMs: opts.tabBudget,
      maxTabs: opts.maxTabs,
      maxWorkspaces: opts.maxWorkspaces,
      viewport: '1180x757',
      headless: !opts.headed,
      contexts: 1,
      storageState: 'none (fresh isolated context)',
      tlsValidation: 'on',
      reloadCheck: opts.reloadCheck,
      selfCheck: opts.selfCheck,
    },
    access: { ok:false, reason: null },
    inventory: { source: null, workspaces: [], persistedDivergence: [], totalTabs: 0, truncated:false },
    reloadCheck: null,
    selfCheck: null,
    tabs: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    notes: [
      'Observed UI states only; nothing here is provider truth or cross-device sync.',
      'Pending/unknown widgets are never reported as a pass.',
      'No storage writes, no mocked responses, no auth headers captured; the app itself still updates its own last-view key as a side effect of real navigation.',
      'An onboarding overlay blocking pointer input is reported, not dismissed.',
      'requestFailures with whileNavigating=true were cancelled while this script navigated away; they are not evidence of a provider outage.',
    ],
  };

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({ viewport: { width: 1180, height: 757 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  let navigating =false;
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ text: msg.text().slice(0, 300) });
  });
  page.on('pageerror', (error) => pageErrors.push({ message: String(error?.message ?? error).slice(0, 300) }));
  page.on('requestfailed', (request) =>
    requestFailures.push({
      url: redactUrl(request.url()),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown',
      whileNavigating: navigating,
    }),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push({ status: response.status(), url: redactUrl(response.url()) });
  });
  const snapshot = () => ({
    consoleErrors: consoleErrors.slice(),
    pageErrors: pageErrors.slice(),
    requestFailures: requestFailures.slice(),
    httpErrors: httpErrors.slice(),
  });
  const delta = (before) => ({
    consoleErrors: consoleErrors.slice(before.consoleErrors.length),
    pageErrors: pageErrors.slice(before.pageErrors.length),
    requestFailures: requestFailures.slice(before.requestFailures.length),
    httpErrors: httpErrors.slice(before.httpErrors.length),
  });

  const workspaceLocator = page.locator('[data-tour="sidebar-workspaces"] div[role="button"][draggable="true"]');
  const tabLocator = page.locator('[data-tour="tab-bar"] div[role="button"][aria-label]');

  const settle = async () => page.waitForTimeout(opts.settle);
  const activeTabId = async (dashboardId) => {
    const state = await readPersisted(page);
    return pickActiveTabId(state.dashboards, state.lastView, dashboardId);
  };
  const overlayNote = async (shot) =>
    shot.overlays.length ? `pointer input may be blocked by overlay: ${shot.overlays.map((o) => o.label).join(' | ')}` : null;

  /** Capture the current tab body with its honest verdict. */
  const capturePass = async (expected) => {
    const shot = await captureRendered(page);
    const { widgets, states } = summarizeWidgets(shot.cells);
    const body = shot.cells.length
      ? 'rendered'
      : shot.markers.emptyTabStarter
        ? 'empty'
        : shot.markers.noTabsAvailable
          ? 'no-tabs'
          : shot.markers.workspaceUnavailable
            ? 'workspace-unavailable'
            : 'unknown';
    const persistedTabId = await activeTabId(expected.workspaceId);
    const navigation =
      (persistedTabId && persistedTabId === expected.tabId) || normalizeKey(shot.activeTabName) === normalizeKey(expected.tabName)
        ? 'pass'
        : 'fail';
    return {
      navigation,
      body: bodyVerdict(body, states),
      activeTabName: shot.activeTabName,
      url: shot.url,
      urlTabId: shot.urlTabId,
      persistedTabId,
      tabsInBar: shot.tabs.map((tab) => tab.name),
      renderedWidgetCount: shot.cells.length,
      widgetStates: states,
      widgets,
      overlays: shot.overlays,
    };
  };

  let exitCode = 0;
  try {
    if (opts.selfCheck) {
      report.selfCheck = await runSelfCheck(context);
      if (report.selfCheck.failed.length > 0) exitCode = 1;
    }
    if (!opts.baseUrl) {
      report.access = { ok:false, reason: 'no --base-url supplied: ran the --self-check assertions only' };
    } else {
      let entryResponse;
      try {
        entryResponse = await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded', timeout: opts.navTimeout });
      } catch (error) {
        report.access = { ok:false, reason: `navigation failed: ${String(error?.message ?? error)}` };
        exitCode = 2;
        throw error;
      }
      report.access = {
        ok: Boolean(entryResponse && entryResponse.status() < 400),
        status: entryResponse ? entryResponse.status() : null,
        finalUrl: redactUrl(page.url()),
        reason: entryResponse && entryResponse.status() >= 400 ? `HTTP ${entryResponse.status()} on ${redactUrl(`${base}/dashboard`)}` : null,
      };
      if (!report.access.ok) exitCode = 2;
    }

    if (report.access.ok) {
      await page.waitForSelector('[data-tour="tab-bar"]', { timeout: opts.navTimeout });
      await settle();

      const firstShot = await captureRendered(page);
      const persisted = await readPersisted(page);
      const persistedById = new Map(
        (Array.isArray(persisted.dashboards) ? persisted.dashboards :[]).map((dashboard) => [
          dashboard.id,
          Array.isArray(dashboard.tabs) ? dashboard.tabs.map((tab) => ({ name: tab.name, widgetCount: Array.isArray(tab.widgets) ? tab.widgets.length : 0 })) : [],
        ]),
      );

      const workspaces = firstShot.workspaces.slice(0, opts.maxWorkspaces);
      report.inventory.source =
        'rendered sidebar workspace items + rendered tab bar per workspace (published layout as displayed)';
      report.inventory.renderedAtEntry = { workspaces: firstShot.workspaces.map((w) => w.name), tabsInBar: firstShot.tabs.map((t) => t.name), overlays: firstShot.overlays };

      const tabRecords = [];
      let visited = 0;
      outer: for (let workspaceIndex = 0; workspaceIndex < workspaces.length; workspaceIndex += 1) {
        const workspaceName = workspaces[workspaceIndex].name;
        const item = workspaceLocator.nth(workspaceIndex);
        const workspacePass = {
          id: null,
          name: workspaceName,
          interaction: null,
          tabs: [],
          persistedTabs: null,
        };

        navigating =true;
        const activation = await activate(item, opts.actionTimeout, await overlayNote(firstShot));
        workspacePass.interaction = activation;
        await settle();
        navigating =false;
        const activated = await captureRendered(page);
        workspacePass.id = activated.urlDashboardId;
        if (!activation.ok || !workspacePass.id) {
          workspacePass.error = activation.ok ? 'workspace id did not appear in the URL after activation' : 'activation failed';
          report.inventory.workspaces.push(workspacePass);
          continue;
        }
        const persistedTabs = persistedById.get(workspacePass.id) ?? null;
        workspacePass.persistedTabs = persistedTabs;
        report.inventory.persistedDivergence.push({
          workspaceId: workspacePass.id,
          renderedTabNames: activated.tabs.map((tab) => tab.name),
          persistedTabNames: persistedTabs ? persistedTabs.map((tab) => tab.name) : null,
          persistedTabWidgetCounts: persistedTabs ? persistedTabs.map((tab) => tab.widgetCount) : null,
          diverges:
            Boolean(persistedTabs) &&
            JSON.stringify(persistedTabs.map((tab) => tab.name)) !== JSON.stringify(activated.tabs.map((tab) => tab.name)),
        });

        const renderedTabs = activated.tabs;
        if (renderedTabs.length === 0) {
          // #110 failure mode: a workspace whose published tabs are empty or
          // unusable. Record it instead of leaving a silently empty tab list.
          workspacePass.renderedNoTabs =true;
          workspacePass.markers = activated.markers;
        }
        for (let tabIndex = 0; tabIndex < renderedTabs.length; tabIndex += 1) {
          if (visited >= opts.maxTabs) {
            report.inventory.truncated =true;
            break outer;
          }
          const tabStarted = Date.now();
          visited += 1;
          const expected = { workspaceId: workspacePass.id, workspaceName, tabName: renderedTabs[tabIndex].name, tabId: null };
          const record = { workspace: { id: workspacePass.id, name: workspaceName }, tab: { name: expected.tabName }, click: null, direct: null };

          // --- click pass: activate the tab in the tab bar -----------------
          const clickBefore = snapshot();
          navigating =true;
          try {
            const activationClick = await activate(tabLocator.nth(tabIndex), opts.actionTimeout, await overlayNote(activated));
            await settle();
            navigating =false;
            const captured = await capturePass(expected);
            record.click = { ...captured, interaction: activationClick, errors: delta(clickBefore) };
            if (!activationClick.ok) record.click.navigation = 'fail';
            if (record.click.navigation === 'pass' && record.click.persistedTabId) expected.tabId = record.click.persistedTabId;
          } catch (error) {
            navigating =false;
            record.click = { navigation: 'fail', body: 'unknown', error: String(error?.message ?? error).slice(0, 240), errors: delta(clickBefore) };
          }
          workspacePass.tabs.push({ name: expected.tabName, id: expected.tabId, navigation: record.click.navigation, body: record.click.body });
          tabRecords.push(record);

          // --- direct pass: ?dashboard=&tab= deep link ---------------------
          const elapsed = Date.now() - tabStarted;
          if (elapsed >= opts.tabBudget) {
            record.direct = {
              navigation: 'skipped',
              body: 'unknown',
              reason: `tab budget ${opts.tabBudget}ms exhausted after the click pass (${elapsed}ms)`,
              errors: { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors:[] },
            };
            continue;
          }
          const directBefore = snapshot();
          const directBudget = Math.min(opts.tabBudget - elapsed, opts.navTimeout);
          const tabParam = expected.tabId || normalizeKey(expected.tabName);
          navigating =true;
          try {
            await page.goto(
              `${base}/dashboard?dashboard=${encodeURIComponent(workspacePass.id)}&tab=${encodeURIComponent(tabParam)}`,
              { waitUntil: 'domcontentloaded', timeout: directBudget },
            );
            await page.waitForSelector('[data-tour="tab-bar"]', { timeout: directBudget });
            await settle();
            navigating =false;
            const captured = await capturePass(expected);
            record.direct = { ...captured, requestedTabParam: tabParam, errors: delta(directBefore) };
          } catch (error) {
            navigating =false;
            record.direct = {
              navigation: 'fail',
              body: 'unknown',
              requestedTabParam: tabParam,
              error: String(error?.message ?? error).slice(0, 240),
              errors: delta(directBefore),
            };
          }
          record.durationMs = Date.now() - tabStarted;
        }
        report.inventory.workspaces.push(workspacePass);
      }


      if (opts.reloadCheck) {
        // Warm-reload regression check: one representative deferred tab,
        // deep-linked, then reloaded for real and sampled to the budget.
        // Prefer a tab whose deep link resolved (that is the same URL the
        // check reloads); fall back to a click-pass tab when a short budget
        // left every direct pass skipped.
        const candidate =
          tabRecords
            .map((record) => {
              const source = record.direct?.navigation === 'pass' ? record.direct : record.click;
              const widgets = source?.widgets ??[];
              return {
                record,
                via: record.direct?.navigation === 'pass' ? 'direct' : 'click',
                deferredHits: widgets.filter((widget) => DEFERRED_WIDGET_TYPES.includes(widget.type)).length,
                widgetCount: widgets.length,
              };
            })
            .filter((entry) => entry.widgetCount > 0 && entry.record.click?.navigation === 'pass')
            .sort((a, b) => b.deferredHits - a.deferredHits || b.widgetCount - a.widgetCount)[0] ?? null;

        if (!candidate) {
          report.reloadCheck = { verdict: 'not-run', reason: 'no visited tab rendered widgets, so there was nothing to reload' };
        } else {
          const target = candidate.record;
          const selectionRule = `${candidate.via} pass candidate; ${candidate.deferredHits > 0 ? 'deferred widget types present' : 'most rendered widgets (no deferred type discovered)'}`;
          const deepLink = `${base}/dashboard?dashboard=${encodeURIComponent(target.workspace.id)}&tab=${encodeURIComponent(target.direct?.requestedTabParam ?? normalizeKey(target.tab.name))}`;
          const check = {
            verdict: 'not-run',
            target: { workspace: target.workspace, tab: target.tab, deepLink },
            selectionRule,
            budgetMs: opts.tabBudget,
            samples: [],
            errors: null,
          };
          const checkBefore = snapshot();
          navigating =true;
          try {
            await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: opts.navTimeout });
            await page.waitForSelector('[data-tour="tab-bar"]', { timeout: opts.navTimeout });
            await settle();
            check.beforeReload = summarizeWidgets((await captureRendered(page)).cells);
            const reloadStarted = Date.now();
            await page.reload({ waitUntil: 'domcontentloaded', timeout: opts.navTimeout });
            await page.waitForSelector('[data-tour="tab-bar"]', { timeout: opts.navTimeout });
            navigating =false;

            let last = null;
            while (true) {
              await page.waitForTimeout(Math.min(2000, Math.max(250, opts.tabBudget - (Date.now() - reloadStarted))));
              const shot = await captureRendered(page);
              last = summarizeWidgets(shot.cells);
              check.samples.push({
                atMs: Date.now() - reloadStarted,
                states: last.states,
                notReady: last.widgets.filter((widget) => widget.state !== 'ready').map((widget) => ({ type: widget.type, state: widget.state, matched: widget.matched })),
              });
              if (last.states.pending === 0 || Date.now() - reloadStarted >= opts.tabBudget) break;
            }
            const stillPending = last.widgets.filter((widget) => widget.state === 'pending');
            check.afterReload = last;
            check.verdict = stillPending.length === 0 ? 'pass' : 'fail';
            check.reason =
              stillPending.length === 0
                ? `every widget left a loading state within ${opts.tabBudget}ms of the warm reload (${last.states.error} error, ${last.states.unavailable} unavailable, ${last.states.unknown} unknown are acceptable terminal states)`
                : `${stillPending.length} widget(s) still literally loading at the ${opts.tabBudget}ms budget terminal after a warm reload`;
            check.stuckWidgets = stillPending;
            if (check.verdict === 'fail') exitCode = 3;
          } catch (error) {
            navigating =false;
            check.verdict = 'error';
            check.reason = String(error?.message ?? error).slice(0, 240);
            exitCode = 1;
          }
          check.errors = delta(checkBefore);
          report.reloadCheck = check;
        }
      }
      report.inventory.totalTabs = visited;
      report.tabs = tabRecords;
    }
  } catch (error) {
    if (exitCode === 0) {
      report.fatal = String(error?.message ?? error).slice(0, 400);
      exitCode = 1;
    }
  } finally {
    report.consoleErrors = consoleErrors.slice(0, 100);
    report.pageErrors = pageErrors.slice(0, 100);
    report.requestFailures = requestFailures.slice(0, 100);
    report.httpErrors = httpErrors.slice(0, 100);
    report.finishedAt = new Date().toISOString();
    report.summary = summarizeRun(report);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const json = JSON.stringify(report, null, 2);
  if (opts.out === '-') {
    process.stdout.write(`${json}\n`);
  } else {
    const target = path.resolve(opts.out);
    await mkdir(path.dirname(target), { recursive:true });
    await writeFile(target, `${json}\n`, 'utf8');
    console.error(`wrote ${target}`);
  }
  return exitCode;
}

function summarizeRun(report) {
  const passes = report.tabs.flatMap((record) => [record.click, record.direct]).filter(Boolean);
  const count = (predicate) => passes.filter(predicate).length;
  return {
    workspaces: report.inventory?.workspaces?.length ?? 0,
    tabsVisited: report.tabs.length,
    navigations: passes.length,
    navigationPass: count((pass) => pass.navigation === 'pass'),
    navigationFail: count((pass) => pass.navigation === 'fail'),
    navigationSkipped: count((pass) => pass.navigation === 'skipped'),
    bodyReady: count((pass) => pass.body === 'ready'),
    bodyPending: count((pass) => pass.body === 'pending'),
    bodyError: count((pass) => pass.body === 'error'),
    bodyUnavailable: count((pass) => pass.body === 'unavailable'),
    bodyUnknown: count((pass) => pass.body === 'unknown' || pass.body === 'mixed' || pass.body === 'no-tabs'),
    truncated: Boolean(report.inventory?.truncated),
    consoleErrors: report.consoleErrors.length,
    requestFailures: report.requestFailures.length,
    requestFailuresCancelledByNavigation: report.requestFailures.filter((failure) => failure.whileNavigating).length,
    requestFailuresOutsideNavigation: report.requestFailures.filter((failure) => !failure.whileNavigating).length,
    requestFailuresByHost: report.requestFailures.reduce((counts, failure) => {
      const host = (() => {
        try {
          return new URL(failure.url).host;
        } catch {
          return 'unknown';
        }
      })();
      counts[host] = (counts[host] ?? 0) + 1;
      return counts;
    }, Object.create(null)),
    httpErrors: report.httpErrors.length,
    httpErrorsByUrl: report.httpErrors.reduce((counts, error) => {
      const key = `${error.status} ${error.url.split('?')[0]}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, Object.create(null)),
    reloadCheckVerdict: report.reloadCheck ? report.reloadCheck.verdict : 'not-run',
    reloadCheckTarget: report.reloadCheck?.target ? `${report.reloadCheck.target.workspace.name}/${report.reloadCheck.target.tab.name}` : null,
    reloadCheckStuckWidgets: (report.reloadCheck?.stuckWidgets ??[]).map((widget) => widget.type),
  };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  });
