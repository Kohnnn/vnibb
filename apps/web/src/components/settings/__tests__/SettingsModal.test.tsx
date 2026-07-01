import * as fs from 'fs'
import * as path from 'path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { UiPreferencesProvider, useUiPreferences } from '@/contexts/UiPreferencesContext'

const SOURCE_FILE = path.resolve(__dirname, '../SettingsModal.tsx')
const GLOBALS_SOURCE_FILE = path.resolve(__dirname, '../../../app/globals.css')

function ColorblindModeProbe() {
  const { colorblindMode, setColorblindMode } = useUiPreferences()

  return (
    <button type="button" onClick={() => setColorblindMode(!colorblindMode)}>
      Colorblind mode {colorblindMode ? 'on' : 'off'}
    </button>
  )
}

describe('SettingsModal — internal QA copy (BUG-03)', () => {
  let source: string

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_FILE, 'utf-8')
  })

  test('does NOT contain "visual QA" in the rendered JSX', () => {
    expect(source).not.toMatch(/visual QA/i)
  })

  test('does NOT contain "color gaps" in the rendered JSX', () => {
    expect(source).not.toMatch(/color gaps/i)
  })

  test('does NOT contain the internal light-mode note in the rendered JSX', () => {
    expect(source).not.toMatch(/Light mode uses the existing token set/i)
  })

  test('still contains the user-facing description "Choose the shell theme"', () => {
    expect(source).toMatch(/Choose the shell theme for this browser/i)
  })
})

describe('SettingsModal — Appearance accessibility toggles (BUG-01)', () => {
  let source: string

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_FILE, 'utf-8')
  })

  test('renders a user-facing colorblind-safe palette toggle in Appearance accessibility', () => {
    // Given: Settings renders Appearance accessibility controls from source.
    expect(source).toMatch(/Accessibility/i)

    // When: the Appearance tab is inspected for color accessibility controls.
    // Then: a labelled switch toggles colorblind-safe mode from UI preferences.
    expect(source).toMatch(/Colorblind-safe palette/i)
    expect(source).toMatch(/checked=\{colorblindMode\}/)
    expect(source).toMatch(/onCheckedChange=\{setColorblindMode\}/)
    expect(source).toMatch(/aria-label="Toggle colorblind-safe palette"/)
  })
})

describe('UiPreferencesProvider — colorblind mode (BUG-01)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-color-mode')
  })

  test('loads the saved colorblind preference and applies the DOM attribute', async () => {
    // Given: the user previously enabled the colorblind-safe palette.
    localStorage.setItem('vnibb-colorblind-mode', 'true')

    // When: UI preferences mount.
    render(
      <UiPreferencesProvider>
        <ColorblindModeProbe />
      </UiPreferencesProvider>,
    )

    // Then: state and the document contract reflect the saved preference.
    expect(await screen.findByRole('button', { name: 'Colorblind mode on' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-color-mode', 'colorblind')
  })

  test('persists colorblind preference changes and updates the DOM attribute', async () => {
    // Given: UI preferences mount with the default palette.
    render(
      <UiPreferencesProvider>
        <ColorblindModeProbe />
      </UiPreferencesProvider>,
    )
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-color-mode', 'default'))

    // When: the user enables the colorblind-safe palette.
    fireEvent.click(screen.getByRole('button', { name: 'Colorblind mode off' }))

    // Then: localStorage and the document attribute are updated.
    expect(await screen.findByRole('button', { name: 'Colorblind mode on' })).toBeInTheDocument()
    expect(localStorage.getItem('vnibb-colorblind-mode')).toBe('true')
    expect(document.documentElement).toHaveAttribute('data-color-mode', 'colorblind')
  })
})

describe('globals.css — accessibility color contracts (BUG-01, BUG-08)', () => {
  let source: string

  beforeAll(() => {
    source = fs.readFileSync(GLOBALS_SOURCE_FILE, 'utf-8')
  })

  test('remaps positive, negative, and warning semantic tokens in colorblind mode', () => {
    // Given: semantic financial colors are token-backed.
    expect(source).toMatch(/\.price-up \{ color: var\(--color-positive\); \}/)

    // When: the colorblind attribute is enabled.
    // Then: the semantic palette remaps away from the default green/red pair.
    expect(source).toMatch(/:root\[data-color-mode=['"]colorblind['"]\]/)
    expect(source).toMatch(/--color-positive:\s*#0072b2/i)
    expect(source).toMatch(/--color-negative:\s*#d55e00/i)
    expect(source).toMatch(/--color-warning:\s*#a65f00/i)
  })

  test('adds a light-theme reduced-effects contrast cue that is not blur or shadow', () => {
    // Given: reduced effects removes blur-heavy widget material.
    expect(source).toMatch(/data-reduce-effects="true"\] \.widget-card-premium/)

    // When: light theme and reduced effects are both active.
    // Then: a border/outline cue preserves card separation without relying on blur or shadow.
    expect(source).toMatch(/:root\.light\[data-reduce-effects="true"\] \.widget-card-premium/)
    expect(source).toMatch(/outline:\s*1px solid color-mix\(in srgb, var\(--color-border-strong\) 70%, transparent\)/)
  })

  test('defines stable light-theme surface aliases used by Tailwind utilities', () => {
    // Given: dashboard components consume both Tailwind v4 tokens and legacy CSS aliases.
    expect(source).toMatch(/@theme inline \{/)

    // When: card and muted utility colors are generated.
    // Then: they resolve through theme-aware aliases instead of falling back to unreadable defaults.
    expect(source).toMatch(/--color-card:\s*var\(--bg-card\);/)
    expect(source).toMatch(/--color-card-foreground:\s*var\(--text-primary\);/)
    expect(source).toMatch(/--color-muted:\s*var\(--bg-tertiary\);/)
    expect(source).toMatch(/--bg-card:\s*var\(--color-bg-elevated\);/)
    expect(source).toMatch(/--bg-tertiary:\s*var\(--color-bg-tertiary\);/)
  })
})
