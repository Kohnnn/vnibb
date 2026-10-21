# Command search and research transfer — 21 October 2026

Baseline `771f45f`; rollback `dpl_7eHiyUcdWrEBEqwKdi1P6o8SZ295`. Repair existing selection controls without dependencies, API/environment/data changes or new search features.

- [x] Command search exposes combobox/listbox/option semantics and stable active-result IDs matching keyboard/pointer selection. Native refreshed/empty results, Enter routing and Escape restoration pass.
- [x] Transfer selection preserves survivors, frees capacity after removal, disables empty download and does not reselect reintroduced keys. Checkbox/export/share-builder consume the same live selection; actual downloaded JSON contains the current selections. Existing import guards remain unchanged.
- [x] Before failures reproduced on both aliases; nine focused tests and typechecking pass. Six native local scenarios cover both groups at desktop/320/390px. Selection refresh uses controlled real same-page settings handlers behind the portal while retaining the modal, not an ordinary concurrent human workflow or injected React state. Signed-in sharing is not exercised; its unchanged preview consumer is source-reviewed.
- [x] One frozen-source full gate passes: lint, typecheck, changelog, build, 1,255 frontend tests and 3,060 backend tests. Standards and spec reviews found zero actionable findings; changelog/docs updated. Scoped commit follows.
- [ ] Deploy exact-commit immutable frontend archive with rollback retained; verify metadata, both aliases, six health probes and unchanged protected backend identities.
- [ ] Verify every improvement on both production aliases, compare loaded assets to the authenticated immutable inventory and commit acceptance evidence.

Notebook discovery found no confirmed defect in its existing export/delete flows, so no speculative search/filter feature is included. No autosave, provider changes, catalogue restrictions, new sharing policy or unrelated next-env/readability/artifact edits. Controlled fixtures establish consumer behavior, not provider truth. Wayfinder is unnecessary for this bounded implementation; no unresolved architecture decisions require a decision map.
