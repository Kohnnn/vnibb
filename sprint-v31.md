# Sprint V31

## Goal
Complete phases 186-205 for production stability, data completeness, and OpenBB parity.

## Tasks
- [ ] Phase 186-187: verify HTTPS/redirects and enforce HTTPS in frontend API base config -> Verify: curl https/http health and confirm API_BASE_URL enforces https
- [ ] Phase 188: implement TradingView fallback with local historical chart and ensure backend historical endpoint exists -> Verify: VN symbol uses fallback and chart renders data
- [ ] Phase 189: update backend status hook to check health + real API -> Verify: badge shows online/degraded/offline correctly
- [ ] Phase 190-193: audit tables, backfill historical data, populate news, validate screener fallback -> Verify: SQL counts, endpoints return populated data
- [ ] Phase 194-198: auto-fit layout, dense tables, dashboard tabs, actionable error UX, research ticker linking -> Verify: UI behaviors match criteria
- [ ] Phase 199-203: sparklines, y-axis units, widget maximize, presets, AI copilot integration -> Verify: UI improvements visible and working
- [ ] Phase 204: run production test checklist locally where possible -> Verify: key endpoints, console errors, core flows
- [ ] Phase 205: document completion status and summarize changes -> Verify: update sprint notes

## Done When
- [ ] All phases 186-205 satisfy success criteria and verification steps above
