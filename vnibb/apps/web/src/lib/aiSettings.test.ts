import {
  AI_SETTINGS_STORAGE_KEY,
  AI_SETTINGS_UPDATED_EVENT,
  clearStoredAISettings,
  OPENAI_COMPATIBLE_BASE_URL,
  OPENROUTER_BASE_URL,
  readStoredAISettings,
  writeStoredAISettings,
} from '@/lib/aiSettings'

describe('aiSettings storage helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('returns OpenRouter defaults when nothing is stored', () => {
    expect(readStoredAISettings()).toEqual({
      mode: 'app_default',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      apiKey: '',
      baseUrl: OPENROUTER_BASE_URL,
      webSearch: false,
      preferAppwriteData: true,
      enableSidebarWorkflowOutputs: false,
    })
  })

  test('persists browser-local overrides and emits an update event', () => {
    const listener = jest.fn()
    window.addEventListener(AI_SETTINGS_UPDATED_EVENT, listener)

    writeStoredAISettings({
      mode: 'browser_key',
      model: 'anthropic/claude-3.5-haiku',
      apiKey: 'sk-or-test',
      webSearch: true,
      preferAppwriteData: false,
      enableSidebarWorkflowOutputs: true,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}')).toMatchObject({
      mode: 'browser_key',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-haiku',
      apiKey: 'sk-or-test',
      baseUrl: OPENROUTER_BASE_URL,
      webSearch: true,
      preferAppwriteData: false,
      enableSidebarWorkflowOutputs: true,
    })
    expect(readStoredAISettings().mode).toBe('browser_key')

    window.removeEventListener(AI_SETTINGS_UPDATED_EVENT, listener)
  })

  test('forces browser-key mode for OpenAI-compatible providers and preserves base URL', () => {
    writeStoredAISettings({
      provider: 'openai_compatible',
      mode: 'app_default',
      model: 'gpt-4.1-mini',
      apiKey: 'openai-test-key',
      baseUrl: OPENAI_COMPATIBLE_BASE_URL,
      enableSidebarWorkflowOutputs: false,
    })

    expect(readStoredAISettings()).toMatchObject({
      provider: 'openai_compatible',
      mode: 'browser_key',
      model: 'gpt-4.1-mini',
      apiKey: 'openai-test-key',
      baseUrl: OPENAI_COMPATIBLE_BASE_URL,
      enableSidebarWorkflowOutputs: false,
    })
  })

  test('clears settings back to defaults', () => {
    writeStoredAISettings({ mode: 'browser_key', apiKey: 'sk-or-test' })

    expect(clearStoredAISettings()).toEqual(readStoredAISettings())
    expect(window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)).toBeNull()
  })
})
