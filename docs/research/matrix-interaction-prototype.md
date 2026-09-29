# #40 prototype — Matrix expanded-space handoff and grid-behavior note

Isolated synthetic artifact for live user reaction. **Not production UI.** Reuses VNIBB visual
conventions and existing components; no new framework; no fabricated live values.

## What this prototype exists to answer

The interaction surface for #40 is almost entirely **already implemented** on `main`:

| #40 item | Status | Evidence |
|---|---|---|
| typed cells | present | `MatrixInspector.tsx` `dimension.output_type`, `payload.metrics` |
| read-only inspector | present | 4 tabs: Result / Evidence / Basis / Review |
| compact/standard/expanded density | present | `MatrixWidget.tsx` density select |
| pinned company identity | present | `pin` in sort comparator |
| selection | present | `selected: Set<string>` |
| no execution from view | present | inspector states view changes never execute research |
| keyboard/focus | present | "Arrow keys move between results · Space selects · Enter inspects · Escape closes inspector" |
| responsive evidence inspector | present | `matchMedia('(max-width: 767px)')` |
| artifact unavailability | present | "No evidence retained. See basis and limitations." |
| hidden selection disclosure | present | `hiddenMatrixSelectionCount(selected, visibleCells)` |
| clipboard fallback | present | "Clipboard unavailable. Select and copy the text below." |
| **embedded-widget vs expanded-widget space** | **MISSING** | `MatrixWidget` has no `MaximizedWidgetPortal` integration |

So this prototype targets the **single genuine gap**: whether Matrix wants expanded-widget space at
all, and if so in which of the two shapes VNIBB already supports.

## The two candidate shapes

**Shape A — full-screen portal (existing convention).**
`MaximizedWidgetPortal` renders outside the grid DOM via `createPortal`, exactly as `WidgetWrapper`
already does at line 897. Focus is trapped, Escape closes, and the restore target is
`restoreFocusRef`. This is what every other widget gets today.

**Shape B — Matrix does not maximize; the inspector is the expansion.**
Matrix already has its own expansion affordance: `MatrixInspector` opens as a portal panel with four
tabs. Adding a second, competing full-screen mode would give the widget two different "expanded"
meanings, and would nest a portal (inspector) inside a portal (maximized), which is where focus
handling and Escape routing get fragile.

## The concrete question to react to

Open the Matrix widget on a frozen snapshot, then try to inspect one cell's evidence:

1. In **Shape A**, the full-screen portal owns the viewport. The inspector opens *inside* it. Escape
   must close **only the inspector** first; a second Escape closes the portal. Two nested portals
   now both claim the Escape key.
2. In **Shape B**, density stays `expanded` and the inspector portal is the only overlay. Escape has
   exactly one meaning at every moment.

**Measured concern with Shape A:** `MaximizedWidgetPortal` registers its own Escape/close handling for
the whole overlay. The inspector panel is `role="dialog"`-like and moves focus to its first button on
mount. Nesting them means the inner panel must stop propagation or the outer portal closes with the
inspector still conceptually open — the user loses the cell they were reading.

## Recommendation for reaction

**Shape B**, with a narrow caveat: expose expanded space only if a real Matrix use case needs a
wider grid than the `expanded` density already provides. Nothing in the #38 playbook (anchor plus a
2–10 company shortlist across five dimensions) demonstrably exceeds that. If a wider view *is* wanted,
extend the inspector to full-screen rather than maximizing the whole widget — one overlay, one Escape
meaning.

## What would falsify this

- A real shortlist (8–10 companies × 5 dimensions + evidence) that is unreadable at `expanded`
  density on a 1440 px viewport.
- A keyboard user who cannot reach a cell's evidence without the widget-level maximize.
- A measured need to compare two cells side by side, which the current single-inspector model cannot
  do at any density.

## Explicitly not in this prototype

Production integration, a new frontend framework, fabricated live values, side-by-side multi-cell
comparison, or any change to the inspector's existing four-tab contract. No execution from any view
operation.
