# V46 Design Tokens

This sprint standardizes theme tokens used by widgets, overlays, and layout controls.

## Core Background Tokens

| Token | Purpose |
| --- | --- |
| `--bg-primary` | App/page background |
| `--bg-secondary` | Card and panel background |
| `--bg-surface` | Elevated surface background |
| `--bg-widget` | Widget body background |
| `--bg-widget-header` | Widget header row background |
| `--bg-dropdown` | Dropdown and menu background |
| `--bg-modal` | Modal container background |
| `--bg-tooltip` | Tooltip background |
| `--bg-hover` | Shared hover background |

## Core Border Tokens

| Token | Purpose |
| --- | --- |
| `--border-color` | Default border color used broadly |
| `--border-default` | Alias for default border |
| `--border-subtle` | Subtle separators and table lines |
| `--border-accent` | Interactive/accent border |

## Core Text Tokens

| Token | Purpose |
| --- | --- |
| `--text-primary` | Primary readable text |
| `--text-secondary` | Secondary text and labels |
| `--text-muted` | Muted helper text |

## Accent Tokens

| Token | Purpose |
| --- | --- |
| `--accent-blue` | Primary accent color |
| `--accent-cyan` | Secondary accent color |

## Notes

- Token aliases are defined in `apps/web/src/app/globals.css`.
- Light mode values are set in `:root.light` and dark mode inherits defaults from the base token stack.
