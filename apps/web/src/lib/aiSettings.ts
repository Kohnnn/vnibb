export const AI_SETTINGS_STORAGE_KEY = 'vnibb-ai-settings'
export const AI_SETTINGS_UPDATED_EVENT = 'vnibb:ai-settings-updated'

export type AIProviderMode = 'app_default' | 'browser_key'

export interface AISettings {
  mode: AIProviderMode
  provider: 'openrouter'
  model: string
  apiKey: string
  webSearch: boolean
  preferAppwriteData: boolean
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  mode: 'app_default',
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  apiKey: '',
  webSearch: false,
  preferAppwriteData: true,
}

type AISettingsUpdate = Partial<AISettings>

function normalizeMode(value: unknown): AIProviderMode {
  return value === 'browser_key' ? 'browser_key' : 'app_default'
}

function normalizeModel(value: unknown): string {
  const normalized = String(value || '').trim()
  return normalized || DEFAULT_AI_SETTINGS.model
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readRawAISettings(): Partial<AISettings> {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AISettings>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readStoredAISettings(): AISettings {
  const raw = readRawAISettings()
  return {
    mode: normalizeMode(raw.mode),
    provider: 'openrouter',
    model: normalizeModel(raw.model),
    apiKey: String(raw.apiKey || '').trim(),
    webSearch: normalizeBoolean(raw.webSearch, DEFAULT_AI_SETTINGS.webSearch),
    preferAppwriteData: normalizeBoolean(
      raw.preferAppwriteData,
      DEFAULT_AI_SETTINGS.preferAppwriteData,
    ),
  }
}

function dispatchAISettingsUpdated(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(AI_SETTINGS_UPDATED_EVENT))
}

export function writeStoredAISettings(next: AISettingsUpdate): AISettings {
  const current = readStoredAISettings()
  const resolved: AISettings = {
    mode: normalizeMode(next.mode ?? current.mode),
    provider: 'openrouter',
    model: normalizeModel(next.model ?? current.model),
    apiKey: String(next.apiKey ?? current.apiKey ?? '').trim(),
    webSearch: normalizeBoolean(next.webSearch, current.webSearch),
    preferAppwriteData: normalizeBoolean(next.preferAppwriteData, current.preferAppwriteData),
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(resolved))
    dispatchAISettingsUpdated()
  }

  return resolved
}

export function clearStoredAISettings(): AISettings {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(AI_SETTINGS_STORAGE_KEY)
    dispatchAISettingsUpdated()
  }

  return DEFAULT_AI_SETTINGS
}
