# Changelog

## 2026-02-22 - Sprint V46 to V52

### Data fixes
- Expanded financial statement fields in backend providers/services and equity API payloads for income statement, balance sheet, and cash flow.
- Added ratio enrichment coverage and additional ratio DTO fields (growth and dividend-oriented metrics included).
- Added new V50 endpoints for parity: peers, TTM aggregates, growth rates, and sector stock drill-down.
- Added comparison path alias support and no-trailing-slash compatibility for screener/comparison routes.
- Hardened market heatmap behavior with stale-cache fallback, explicit provider timeout guard, and safe empty-state response fallback.

### UI/UX fixes
- Migrated modal and command palette surfaces to opaque theme-token based styling to resolve transparency and dark-stuck issues.
- Extended light/dark-safe token migration across key dashboard widgets and screener controls.
- Improved template selector previews with richer visual cards.
- Added runtime stale-tab cleanup and improved empty-tab quick-add actions.
- Added chart mount guards for multiple financial widgets to reduce hidden-container chart dimension warnings.

### New features and parity improvements
- Added frontend support for peers endpoint and expanded financial typings.
- Expanded financial widgets to render newly available statement/ratio fields.
- Continued parity work for comparison analysis and period-aware data flows in V52 track.

### Quality gates completed
- Backend tests: `cd apps/api && pytest tests -q` (70 passed)
- Focused API regressions: smoke endpoints and sector endpoint suites passing
- Frontend lint/build passing
- Monorepo lint/test/build passing

### Deployment readiness notes
- Code-level fixes are ready for deployment.
- Latest production probe before deploy still reflects old deployment behavior on new V49/V50 routes.
- Post-deploy verification should re-run endpoint matrix and widget smoke checks.
