# Local Workspace acceptance — isolated branch, 2026-09-27

Scope: `feat/openbb-workspace-polish` in the isolated `/tmp/vnibb-workspace-implementation` worktree. This is **local browser proof**, not production deployment or live market-data validation. Chromium visited the production Next.js build at `http://localhost:3001/dashboard`; `NEXT_PUBLIC_API_URL` pointed at an unavailable local API. Network-error panels therefore demonstrate error-state containment only, not successful chart/data rendering.

## Observed browser results

| CSS viewport | Measured grid (px) | Page scroll width (px) | Grid tiles | Overlap | Off-screen tile |
| --- | ---: | ---: | ---: | --- | --- |
| 360×800 | 344 | 360 | 6 | no | no |
| 390×844 | 374 | 390 | 6 | no | no |
| 768×1024 | 744 | 768 | 6 | no | no |
| 1024×768 | 740 | 1024 | 6 | no | no |
| 1440×900 | 1156 | 1440 | 6 | no | no |
| 1920×1080 | 1636 | 1920 | 6 | no | no |

Rectangles were measured from the actual `.react-grid-item` elements after resize settled; horizontal page overflow was absent at every sample. The 390 px capture displayed the native valuation chart's controls and a visible network-error panel without horizontal page scrolling. The failure is expected with the local API down.

Measured-grid boundaries were checked at 639/640/641, 767/768/769, and 1023/1024/1025 px using CSS viewports 663/664/665, 791/792/793, and 1307/1308/1309 respectively. Page scroll widths matched the corresponding viewport widths throughout. The sidebar transition at 1440 px changed grid width from 1156 to 1352 and back; opening VniAgent in overlay mode kept it at 1156. A personal workspace's stored five widget IDs and `x/y/w/h` values were unchanged after sidebar, agent, reload, 390→1440 viewing, and maximize→restore transitions. Edit mode on that personal workspace was enabled at 1156 px and disabled at 374 px; the saved geometry remained unchanged.

At a 1440×900 headless Chromium browser viewport, an isolated temporary extension invoked Chrome's **`chrome.tabs.setZoom`** on a restored five-widget personal dashboard: 100% yielded `innerWidth=1440`, DPR 1, grid 1156 px; 125% yielded `innerWidth=1152`, DPR 1.25, grid 868 px; 200% yielded `innerWidth=720`, DPR 2, grid 696 px. All three had five non-overlapping widget rectangles, document scroll width equal to effective `innerWidth`, and byte-equal saved widget IDs/layouts/configuration. This was browser page zoom, not device-scale or viewport emulation. Captures: [100%](workspace-chromium-zoom-100.png), [125%](workspace-chromium-zoom-125.png), [200%](workspace-chromium-zoom-200.png). The temporary extension and browser profile are not part of the application.

The **Backup workspaces** UI downloaded an actual 1,990-byte `vnibb-personal-workspace` JSON blob for one personal dashboard. Uploading the downloaded bytes previewed one dashboard, one tab, five widgets, two sync groups, and zero folders. **Import as new workspaces** created a fresh dashboard/widget/layout ID set, preserving all five widget types and coordinates; the original dashboard remained untouched. Uploading a modified backup with `config.apiKey` was rejected with an alert and left the dashboard count at six. No backend synchronization or production database was involved.

After the final rebuild, the system Overview mounted **Valuation Multiples Chart** and displayed a visible network-error state without a render-loop error. From an imported dashboard scoped to `NASDAQ:AAPL`, **Add TradingView Chart Widget** created a chart on the Global Markets destination with `config.symbol=NASDAQ:AAPL` and set that destination's linked ticker to `NASDAQ:AAPL`; the imported source ticker remained `NASDAQ:AAPL`. The invalid backup upload now reports **“Workspace backup contains unsafe configuration. No workspaces were imported.”**

On the final production build, a browser-local test copy mounted `drawdown_deep_dive`, `hurst_market_structure`, `quant_summary`, and `dividend_ladder` alongside five existing widgets. All nine grid tiles remained mounted at 1440 px with no horizontal page overflow or browser runtime exception; the diagnostics contained only refused requests to the deliberately unavailable local API. The four added smoke widgets were removed from the test copy afterward. Focused parent-callback regressions cover empty, loaded, error and symbol transitions; this browser run exercised the offline/error state, not loaded quantitative data.

Playwright **Firefox 146** and **WebKit 26** independently loaded the production preview after dismissing first-run onboarding and release notes. At 1440×900 both measured a 1156 px grid with six non-overlapping tiles and 1440 px page scroll width. At 390×844 Firefox measured a 374 px grid; WebKit measured 368 px; each had six non-overlapping tiles and 390 px page scroll width. Both uploaded the previously exported JSON fixture, previewed it, and confirmed **“Imported 1 dashboard as new local workspaces.”** Each engine's local storage contained exactly one fresh `import-` dashboard. Captures: [Firefox desktop](workspace-firefox-1440.png), [Firefox phone](workspace-firefox-390.png), [WebKit desktop](workspace-webkit-1440.png), [WebKit phone](workspace-webkit-390.png). The controlled fixture contained five widgets with no live financial data. This is an engine-level smoke, not a full per-widget visual audit.

## Explicit limits

- Chromium, Firefox and WebKit were exercised on desktop CSS viewports; Firefox/WebKit also covered 1440×900, 390×844 and restore-as-copy. Native Chromium browser zoom at 100%/125%/200% was exercised separately. A real touch device was **not exercised**; CSS viewport emulation is not physical-touch proof.
- The backend was unavailable. Loaded financial values, successful chart SVG lifecycle, TradingView iframe interiors, sticky-header behavior under large real datasets, and error→retry→success were **not verified in this browser run**. Existing component/contract tests cover deterministic local transitions; they do not replace these omitted real-browser scenarios.
- The six-width rectangle sweep used a six-widget template; the personal five-widget workspace supplied persistence and backup proof. It is not a claim that every one of the 174 registered widget types was visually exercised. Native families were inventoried in [the registry ledger](WIDGET_FAMILY_INVENTORY.md); unusual embeds and placeholders need their own provider-aware verification before a broad compatibility claim.
- No admin/system layout was imported or published in this browser session. The explicit TradingView command changed the Global Markets destination's saved local ticker, as intended; it did not publish an admin template. Backup export excludes system dashboards by contract, but a live backend sync trace was not collected because the local API was down.
