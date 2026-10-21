# Research draft ownership — 21 October 2026

Baseline `53e334a`; rollback `dpl_AYzvVVC69bKEp6wjJSBFMP9vKgNR`. Protect existing explicit-save research editing without autosave, dependencies or new persistent draft storage.

- [x] Unsaved thesis fields, legacy notes and evidence attach/detach survive ticker navigation with independent unsaved state; saved due-review navigation remains usable.
- [x] Config refresh preserves dirty drafts while untouched/saved tickers follow persisted values. Native Widget settings JSON controls exercise the refresh without React internals.
- [x] Explicit Save persists only the active ticker, preserves other persisted data and drafts, and returns the saved ticker to persisted config. Reload retains saved content only; no autosave or new draft storage.
- [x] Three red regressions reproduced the failures; 24 focused tests and typechecking pass. Nine native local scenarios cover all three groups at desktop/320/390px, including evidence, settings refresh, isolated Save and reload. Both-alias production before replay reproduced all groups; screenshots inspected and all disposable contexts closed with zero API writes.
- [x] Full nine-stage gate passes (171 suites/1,252 frontend tests; 3,060 backend tests); independent standards/spec reviews found no issues. Changelog/docs updated for the scoped current-branch commit.
- [ ] Deploy immutable exact-commit frontend archive with rollback retained; verify metadata, both aliases, six health probes and unchanged protected backend IDs/images.
- [ ] Exercise every group on both production aliases, bind loaded assets to the immutable release, and commit acceptance evidence.

No portfolio/alert changes: discovery found no confirmed defect there. No API/environment/data changes, conflict-resolution framework, new draft persistence, notification policy, provider truth claims or unrelated next-env/readability/artifact edits. Controlled local state proves consumer ownership only.
