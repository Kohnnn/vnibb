'use client'

import type { WidgetConfig } from '@/types/dashboard'

/**
 * Durable records for widgets promoted from a VniAgent artifact.
 *
 * Two separate stores, both browser-local:
 * - `ARTIFACT_WIDGET_PROVENANCE_KEY` lives on the created widget's own `config`
 *   (it travels with the widget, survives reload and workspace export), keyed by
 *   widget id so it can be re-read after a reload.
 * - `ARTIFACT_PLACEMENT_KEY` remembers the last destination a user picked so the
 *   remaining artifacts of the same response default to it.
 */

export const ARTIFACT_PLACEMENT_KEY = 'vnibb-copilot-artifact-placement'
export const ARTIFACT_WIDGET_PROVENANCE_KEY = 'copilotArtifactProvenance'

export interface ArtifactWidgetProvenance {
  /** Artifact id from the copilot response (e.g. `price_trend_chart`). */
  artifactId: string
  /** Stable response identity the artifact came from. */
  responseId: string
  /** Source family, so `table`/`chart` provenance stays distinguishable. */
  artifactType: string
  artifactTitle: string
  dashboardId: string
  tabId: string
  /** `${dashboardName} / ${tabName}` at the moment of promotion. */
  destination: string
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Read the provenance marker embedded in a widget config, if any. */
export function readArtifactProvenance(config?: WidgetConfig | null): ArtifactWidgetProvenance | null {
  if (!isRecord(config)) return null
  const raw = config[ARTIFACT_WIDGET_PROVENANCE_KEY]
  if (!isRecord(raw)) return null
  const artifactId = text(raw.artifactId)
  const responseId = text(raw.responseId)
  if (!artifactId || !responseId) return null
  return {
    artifactId,
    responseId,
    artifactType: text(raw.artifactType) || 'artifact',
    artifactTitle: text(raw.artifactTitle) || artifactId,
    dashboardId: text(raw.dashboardId) || '',
    tabId: text(raw.tabId) || '',
    destination: text(raw.destination) || '',
    createdAt: text(raw.createdAt) || '',
  }
}

/** Build the config fragment written onto a widget created from an artifact. */
export function buildArtifactProvenance(
  input: Omit<ArtifactWidgetProvenance, 'createdAt'>,
): WidgetConfig {
  return {
    [ARTIFACT_WIDGET_PROVENANCE_KEY]: {
      ...input,
      createdAt: new Date().toISOString(),
    } satisfies ArtifactWidgetProvenance,
  }
}

/** Durable id-keyed index of promoted artifacts, so the card can restore its state. */
function readProvenanceIndex(): Record<string, ArtifactWidgetProvenance> {
  const store = storage()
  if (!store) return {}
  try {
    const parsed: unknown = JSON.parse(store.getItem(ARTIFACT_WIDGET_PROVENANCE_KEY) || '{}')
    if (!isRecord(parsed)) return {}
    const index: Record<string, ArtifactWidgetProvenance> = {}
    Object.entries(parsed).forEach(([widgetId, value]) => {
      if (!isRecord(value)) return
      const artifactId = text(value.artifactId)
      const responseId = text(value.responseId)
      if (!artifactId || !responseId) return
      index[widgetId] = {
        artifactId,
        responseId,
        artifactType: text(value.artifactType) || 'artifact',
        artifactTitle: text(value.artifactTitle) || artifactId,
        dashboardId: text(value.dashboardId) || '',
        tabId: text(value.tabId) || '',
        destination: text(value.destination) || '',
        createdAt: text(value.createdAt) || '',
      }
    })
    return index
  } catch {
    return {}
  }
}

/** All promoted widgets, keyed by widget id. Used to restore card state on load. */
export function readArtifactWidgetProvenanceIndex(): Record<string, ArtifactWidgetProvenance> {
  return readProvenanceIndex()
}

/** True when the widget id maps to a promotion of this response. */
function indexConfirmsResponse(
  index: Record<string, ArtifactWidgetProvenance>,
  widgetId: string,
  responseId: string,
): boolean {
  return index[widgetId]?.responseId === responseId
}


/**
 * Which response produced the widget with this id, if any. Confirms against the
 * durable index when present; falls back to the widget's own config marker.
 */
export function findArtifactWidgetResponseId(
  widgetId: string,
  widgetConfig?: WidgetConfig | null,
): string | undefined {
  const index = readProvenanceIndex()
  const marker = readArtifactProvenance(widgetConfig)

  if (marker && !indexConfirmsResponse(index, widgetId, marker.responseId) && index[widgetId] !== undefined) {
    // Conflicting records — prefer the widget's own config marker.
    return marker.responseId
  }

  if (marker) {
    if (index[widgetId] === undefined || index[widgetId].responseId === marker.responseId) {
      return marker.responseId
    }
  }

  const indexed = index[widgetId]
  if (indexed && (!widgetConfig || !isRecord(widgetConfig))) return indexed.responseId
  return undefined
}

/** Persist the provenance for a promoted widget (called right after `addWidget`). */
export function recordArtifactProvenance(widgetId: string, provenance: ArtifactWidgetProvenance): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(
      ARTIFACT_WIDGET_PROVENANCE_KEY,
      JSON.stringify({ ...readProvenanceIndex(), [widgetId]: provenance }),
    )
  } catch {
    // Best-effort: the widget config marker is the primary record.
  }
}

/** Remember the destination a user picked, for the rest of this response and future reloads. */
export function rememberArtifactPlacement(dashboardId: string, tabId: string, label: string): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(ARTIFACT_PLACEMENT_KEY, JSON.stringify({ dashboardId, tabId, label }))
  } catch {
    // Best-effort.
  }
}

export interface ArtifactPlacement {
  dashboardId: string
  tabId: string
  label?: string
}

/** Last destination the user picked, restored across reloads. */
export function readArtifactPlacement(): ArtifactPlacement | null {
  const store = storage()
  if (!store) return null
  try {
    const parsed: unknown = JSON.parse(store.getItem(ARTIFACT_PLACEMENT_KEY) || 'null')
    if (!isRecord(parsed)) return null
    const dashboardId = text(parsed.dashboardId)
    const tabId = text(parsed.tabId)
    if (!dashboardId || !tabId) return null
    return { dashboardId, tabId, label: text(parsed.label) }
  } catch {
    return null
  }
}
