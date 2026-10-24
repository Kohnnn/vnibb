# Alert overlay and research import batch — 20 October 2026

Goal: improve existing alert access and research-file selection without a new popover framework or dependencies. Baseline `734550c`; rollback `dpl_DYPB4MKXMcedw6mkp3xAYF29iLXf`.

- [x] Alert activity supports keyboard entry, contained Tab navigation, Escape and close/backdrop dismissal with opener restoration; existing Retry/filter/activity behavior passes native checks.
- [x] The real mobile bell is reachable at 320/390px; the panel fits the viewport with reachable controls and internal list scrolling. Desktop placement remains intact.
- [x] The bell exposes expanded state and a stable relationship to the labeled dialog; existing shared focus handling is reused.
- [x] Research selection is latest-wins for success/failure with immediate preview clearing and unmount invalidation. Native malformed/oversize validation, actual local import and export round-trip controls pass.
- [x] Before reproductions, seven focused rendered regressions, typechecking and native local acceptance pass; the full nine-stage gate passes (171 frontend suites, 1,242 frontend tests, 3,060 backend tests). Independent standards/spec reviews found no actionable issues.
- [x] Full gate and independent reviews passed; scoped code/tests/changelog/docs committed as `a18fd35` on the current branch.
- [x] Immutable frontend archive deployed as `dpl_4bZ5sQF7efKggXH7RPEBMqtg2St5`; exact metadata, both aliases, six health probes and unchanged protected backend IDs/images passed. Previous release retained for rollback.
- [x] Both aliases passed all four groups through 16 native scenario executions and 108 assertions, including real local import/export controls. Release-bound acceptance is recorded in the [release record](qa-improvement-plan.md#alert-overlay-and-research-file-ownership--20-october-2026).

Seams: existing rendered AlertNotificationPanel and ResearchBundleModal tests, then native dashboard keyboard/mobile geometry and deferred File.text() reads through the real file input. Controlled reads prove consumer ownership, not provider truth. No API/data/environment changes, notification/read/filter-policy changes, catalogue-based symbol restrictions, broad overlay redesign or unrelated readability/next-env/artifact edits.
