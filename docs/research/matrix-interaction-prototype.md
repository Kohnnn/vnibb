# #40 prototype — Matrix maximize/inspector interaction (corrected)

> **Correction notice.** An earlier revision of this artifact claimed expanded space was `MISSING`
> and described a "one Escape closes both" behavior as *measured*. Both were wrong. Corrections are
> recorded below rather than silently overwritten, because the earlier claim was shipped to the
> ticket.

Isolated synthetic artifact for live user reaction. **Not production UI.** Reuses VNIBB visual
conventions and existing components; no new framework; no fabricated live values.

## Correction 1 — Matrix already maximizes (earlier claim: MISSING)

False negative from searching `MatrixWidget.tsx` for `MaximizedWidgetPortal` instead of tracing the
render path. Maximization is centralized in the shared wrapper:

- `DashboardClient.tsx:1481` renders **every** grid widget through `WidgetWrapper`.
- `WidgetWrapper.tsx:776–777` passes `isMaximized={isMaximized} onMaximize={handleMaximize}` into the
  toolbar.
- `WidgetWrapper.tsx:896–908` portals that same widget content into `MaximizedWidgetPortal`.

So Matrix already maximizes, and `MatrixWidget` correctly does **not** import the portal itself.
There is no missing capability and nothing to add. The earlier "Shape B — Matrix does not maximize"
recommendation would have **removed an existing control**.

## Correction 2 — the Escape claim was asserted, not measured

Earlier text called a static-code suspicion a "Measured concern" and claimed one Escape closes the
inspector *and* the portal. No browser session was run. Reading the actual attachment points:

- `MaximizedWidgetPortal.tsx:69` binds `document.addEventListener('keydown', handleKeys)`.
- `MatrixInspector.tsx:54` binds React `onKeyDown` on the `<aside>` **DOM node**, not on `document`.

React delegates synthetic events to the root container, so `stopPropagation()` there prevents the
event from reaching `document`. **On desktop the portal's listener should therefore not fire** —
one Escape closes only the inspector. The earlier claim is likely the reverse of the truth.

**This remains unproven and must not be restated as fact.** The two widths differ concretely:

- **Narrow (<768 px):** `MatrixInspector.tsx:87` portals the panel to `document.body` at
  `zIndex: 10000` — a sibling of the outer dialog, not a descendant. Key events from a body-level
  portal still propagate to `document`, so the outer handler is reachable by a different path than
  on desktop.
- **Desktop:** inspector renders in place, nested inside the outer dialog.

Whether these compose correctly — first Escape closes only the inspector, focus returns to the
invoking cell, and the maximized view survives — is **the actual open question**.

## What the prototype now is

A browser exercise of the **already-available** maximize and inspector, at both widths. Not a
proposal to add UI. The measured outcomes to capture:

| Step | Desktop expectation | Narrow expectation |
|---|---|---|
| Maximize Matrix, open a cell's evidence | inspector opens inside the maximized view | inspector covers viewport at `zIndex 10000` |
| Press Escape once | **only** inspector closes (unverified) | **?** — body-level portal, path differs |
| Press Escape again | maximized view closes | **?** |
| Focus after inspector closes | returns to the invoking cell | **?** |
| Reopen inspector without re-maximizing | unchanged snapshot/revision | **?** |

Every `?` is a genuine unknown. The static reading predicts desktop behaves correctly; it does not
establish it, and it says nothing reliable about narrow.

## Recommendation for reaction

**Do not modify the shared wrapper or MatrixWidget.** Maximize already works; touching shared UI for
an existing control risks every other widget for no gain.

The decision this ticket actually needs is narrow: **if** the browser exercise shows the nested
inspector misbehaving under maximize at either width, decide how it should behave. If both widths
compose correctly, #40's interaction surface is complete and the ticket closes on that evidence.

## What would falsify the current (unverified) reading

- Escape reaching the portal's document listener while the inspector is open on desktop.
- Focus escaping the maximized view, or landing on a detached node, after the inspector closes.
- Narrow-width behavior differing from desktop in a way not accounted for by the body-level portal.

## Explicitly not in this prototype

Production integration, changes to `WidgetWrapper` or `MaximizedWidgetPortal`, a new frontend
framework, fabricated live values, side-by-side multi-cell comparison, or any change to the
inspector's four-tab contract. No execution from any view operation.
