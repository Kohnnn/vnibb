# Application improvement batch — 20 October 2026

Goal: ship six confirmed usability and recovery improvements together, without API/data changes or new dependencies.

- [x] Mobile Settings: all six sections reachable at 390px with keyboard selection, reopen retention and synchronized desktop selection after resize. Body portal prevents hidden-navigation ancestry.
- [x] Sidebar keyboard handling: native multiword workspace/folder names persist, named focus-visible actions open with Enter/Space, direct row activation remains intact.
- [x] Research transfer modal: desktop/mobile entry, twenty Tab/Shift+Tab cycles, child-only Escape and opener restoration pass. Existing focus trap now grants ownership only to the topmost dialog, preventing competition with mobile Navigation.
- [x] Foreign Trading recovery: render empty embedded provider failures as retryable errors; native local Retry reissued the GET and displayed net +1.0K. Normal empty coverage and populated fallback remain unchanged.
- [x] News + Corporate Actions recovery: terminal Retry refreshes all three sources; native dividend/insider failures recovered to payout/insider content through actual failed-source GETs.
- [x] Matrix error ownership: obsolete rejected preparations after anchor/company/playbook edits stay hidden; native current failures remain visible, busy clears and Prepare is enabled.
- [x] Focused rendered regressions and native before/after interactions passed; typechecking and the complete nine-stage gate passed (169 frontend suites, 1,230 frontend tests, 3,060 backend tests). Standards and spec reviews found no issues.
- [ ] Commit only the scoped batch, deploy its immutable archive frontend-only with rollback retained, verify all six behaviors on both aliases, and commit acceptance evidence.

Test seams: existing rendered component tests and native dashboard interactions. No source-text assertions or private-state tests. Existing source-inspection tests in modified files are removed rather than repinned.

Out of scope: speculative features, new retry infrastructure, global-ticker policy, provider/data repair, API/environment changes, unrelated readability work and generated Next.js environment changes. Frozen Matrix snapshots are not declared stale without a freshness contract. Concurrent Prepare requests are not a candidate because the button is disabled while busy.
