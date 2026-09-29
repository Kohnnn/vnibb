# #40 prototype — Matrix maximize/inspector interaction (corrected + measured)

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
invoking cell, and the maximized view survives — was the open question. It is now **measured**.

## Measured result — Escape nesting is correct at both widths

Exercised with a throwaway Jest harness (jsdom) composing the **real** `MaximizedWidgetPortal`
with an inspector clone matching `MatrixInspector`'s actual binding: React `onKeyDown` on the
`<aside>`, calling `stopPropagation()` then closing. The harness was deleted after the run; it
existed to settle this question, not to ship.

| Composition | One Escape with inspector open | Escape with no inspector open |
|---|---|---|
| Desktop (inspector nested in the dialog) | `inspector=no`, `maximized=yes` | `maximized=no` |
| Narrow (inspector portaled to `document.body`, `zIndex 10000`) | `inspector=no`, `maximized=yes` | — |

**The nested-overlay risk does not exist.** One Escape closes only the inspector and the maximized
view survives, at both widths. React delegates synthetic events to the root container, so the inner
`stopPropagation()` prevents the event reaching the portal's `document` listener — and this holds
even when the inspector is a `document.body` sibling, because the listener never sees the event.

My original claim ("one Escape closes both") was the reverse of the measured behavior.

## Scope of this evidence

Measured in jsdom, not a real browser. jsdom reproduces React's synthetic-event delegation, which is
the mechanism under test, so the Escape finding is sound. It does **not** exercise layout, real
focus-ring rendering, or viewport-dependent readability — those remain unverified, and the
readability question below is still open.
## Recommendation

**Do not modify the shared wrapper or MatrixWidget.** Maximize already works, and the nested Escape
path measured correct at both widths. Touching shared UI for a working control risks every other
widget for no gain.

One item remains genuinely open, and it is **not** an interaction defect: **readability**. Nothing
has measured whether a real shortlist (8–10 companies × 5 dimensions plus evidence) is legible at
`expanded` density versus maximized. That is the only question left before #40 can close, and it
needs a real viewport — jsdom cannot answer it.

## What would falsify the above

- A real shortlist unreadable at `expanded` density that becomes readable when maximized — which
  would make maximize a *load-bearing* affordance rather than a convenience.
- Focus escaping the maximized view, or landing on a detached node, after the inspector closes in a
  real browser (jsdom does not model layout or detached-node focus).
- Real-browser narrowing behaving differently from the jsdom result.

## Explicitly not in this prototype

Production integration, changes to `WidgetWrapper` or `MaximizedWidgetPortal`, a new frontend
framework, fabricated live values, side-by-side multi-cell comparison, or any change to the
inspector's four-tab contract. No execution from any view operation.
