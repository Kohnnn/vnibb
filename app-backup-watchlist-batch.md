# Workspace backup and watchlist consistency — 21 October 2026

Baseline `9ba5735`; rollback `dpl_4bZ5sQF7efKggXH7RPEBMqtg2St5`. Repair existing local workflows, without dependencies or API/environment/data changes.

- [x] Workspace backup close/reopen starts a clean session: no previous file preview, restore action, error or status remains. Native export and append-only restore controls pass.
- [x] Pending backup reads are invalidated on close; obsolete success/error/finally cannot alter a reopened session or disable its input. Existing size/schema validation and current-read lock pass.
- [x] Watchlist additions reuse `normalizeTickerSymbol`; malformed input stays editable with an accessible error and is never appended/persisted/subscribed. Valid unknown normalized symbols, duplicates, sort, clear and reload pass.
- [x] Before reproductions, 23 focused tests across three suites, typechecking and seven native local scenarios pass in disposable contexts. No API writes occurred.
- [x] Full nine-stage gate passed (171 suites/1,249 frontend tests; 3,060 backend tests); independent standards/spec reviews found no issues. Changelog/docs updated for the scoped commit on the current branch.
- [ ] Deploy immutable exact-commit frontend archive with rollback retained; verify metadata, both aliases, six health probes and unchanged protected backend IDs/images.
- [ ] Exercise all three improvements on both production aliases and commit release-bound acceptance evidence.

Seams: WorkspaceBackupModal/Sidebar lifecycle and WatchlistWidget rendered tests; native real file upload with deferred File.text and local widget config. Controlled inputs prove consumer behavior only. No notes-draft redesign, speculative concurrent config merge, catalogue-membership restrictions, provider changes, notification changes, new shared abstractions or unrelated next-env/readability/artifact edits.
