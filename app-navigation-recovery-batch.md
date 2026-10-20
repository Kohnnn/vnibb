# Navigation and alert recovery batch — 20 October 2026

Goal: improve existing tab management and alert recovery without new dependencies, backend changes or production-data mutations. Baseline: `a5828f9`; deployed rollback: `dpl_Cg4kzfUyBWcT3N4Bfk6aKVka7azw`.

- [x] Manage Tabs uses the shared 12-tab ceiling; native delete/re-add and legacy 13-tab save/reload preserve all retained tabs and widgets.
- [x] Alt+ArrowUp/ArrowDown reorders handles with retained focus, boundaries and contiguous saved order; native pointer dragging and widget sentinels remain intact.
- [x] TabBar exposes exactly the active button with `aria-current="page"`; native selection changes preserve existing button interactions.
- [x] Insider-alert errors offer current-filter Retry while preserving local/cached activity; native failure-to-row and failure-to-empty recovery clears errors without false empty coverage.
- [x] Before reproduction and ten focused regressions pass after fixes; typechecking, native local acceptance and the full nine-stage gate pass (171 frontend suites, 1,239 frontend tests, 3,060 backend tests).
- [ ] Review standards and spec independently; commit only scoped code/tests/changelog/plan to the current branch.
- [ ] Deploy an immutable archive of that exact commit frontend-only; preserve rollback, verify metadata and both aliases, six health probes and unchanged protected backend container IDs/images.
- [ ] Exercise every acceptance scenario against both production aliases and commit the acceptance record.

Test seams: existing rendered components with real focus/query behavior where practical; native dashboard interactions in disposable browser contexts, with controlled GET responses for alert errors/recovery. Controlled responses prove consumers, not provider truth. No source-text or mock-forwarding assertions. Preserve unrelated `next-env.d.ts`, readability experiments and artifacts. No API/environment/data changes or speculative features.
