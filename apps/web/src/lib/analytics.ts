import { env } from './env'

type AnalyticsScalar = string | number | boolean
type AnalyticsValue = AnalyticsScalar | AnalyticsScalar[] | null | undefined
type AnalyticsProperties = Record<string, AnalyticsValue>
type PostHogClient = typeof import('posthog-js').default

export const ANALYTICS_EVENTS = {
  adminAiRuntimeSaved: 'admin_ai_runtime_saved',
  adminLayoutControlsToggled: 'admin_layout_controls_toggled',
  adminLayoutKeyCleared: 'admin_layout_key_cleared',
  adminLayoutKeySaved: 'admin_layout_key_saved',
  adminLayoutKeyValidationFailed: 'admin_layout_key_validation_failed',
  adminPromptDraftAdded: 'admin_prompt_draft_added',
  adminPromptLibrarySaved: 'admin_prompt_library_saved',
  adminPromptRemoved: 'admin_prompt_removed',
  adminUnitRuntimeSaved: 'admin_unit_runtime_saved',
  appsLibraryOpened: 'apps_library_opened',
  authLoginFailed: 'auth_login_failed',
  authLoginStarted: 'auth_login_started',
  authLoginSucceeded: 'auth_login_succeeded',
  authSignupFailed: 'auth_signup_failed',
  authSignupStarted: 'auth_signup_started',
  authSignupSucceeded: 'auth_signup_succeeded',
  commandPaletteOpened: 'command_palette_opened',
  commandPaletteResultSelected: 'command_palette_result_selected',
  copilotDocumentAttached: 'copilot_document_attached',
  copilotExported: 'copilot_exported',
  copilotFeedbackSubmitted: 'copilot_feedback_submitted',
  copilotNewChatStarted: 'copilot_new_chat_started',
  copilotOpened: 'copilot_opened',
  copilotPromptLibraryOpened: 'copilot_prompt_library_opened',
  copilotPromptLibrarySelected: 'copilot_prompt_library_selected',
  copilotPromptSubmitted: 'copilot_prompt_submitted',
  copilotResponseCompleted: 'copilot_response_completed',
  copilotResponseFailed: 'copilot_response_failed',
  dataSourceChanged: 'data_source_changed',
  decimalPlacesChanged: 'decimal_places_changed',
  folderCreated: 'folder_created',
  folderDeleted: 'folder_deleted',
  folderRenamed: 'folder_renamed',
  folderToggled: 'folder_toggled',
  layoutAction: 'layout_action',
  mobileMenuClosed: 'mobile_menu_closed',
  mobileMenuOpened: 'mobile_menu_opened',
  onboardingWalkthroughCompleted: 'onboarding_walkthrough_completed',
  onboardingWalkthroughStarted: 'onboarding_walkthrough_started',
  onboardingWalkthroughStepViewed: 'onboarding_walkthrough_step_viewed',
  preferencesSaved: 'preferences_saved',
  promptLibraryOpened: 'prompt_library_opened',
  promptLibraryPromptAdded: 'prompt_library_prompt_added',
  promptLibraryPromptDeleted: 'prompt_library_prompt_deleted',
  settingsOpened: 'settings_opened',
  settingsTabViewed: 'settings_tab_viewed',
  sidebarCollapsedToggled: 'sidebar_collapsed_toggled',
  symbolChanged: 'symbol_changed',
  symbolSearchSubmitted: 'symbol_search_submitted',
  tabCreated: 'tab_created',
  tabDeleted: 'tab_deleted',
  tabManagementOpened: 'tab_management_opened',
  tabRenamed: 'tab_renamed',
  tabReordered: 'tab_reordered',
  tabSwitched: 'tab_switched',
  templateSelectorOpened: 'template_selector_opened',
  unitDisplayChanged: 'unit_display_changed',
  usdRateOverrideUpdated: 'usd_rate_override_updated',
  usdRateOverridesReset: 'usd_rate_overrides_reset',
  walkthroughRestartRequested: 'walkthrough_restart_requested',
  widgetAction: 'widget_action',
  widgetAdded: 'widget_added',
  widgetBatchAdded: 'widget_batch_added',
  widgetCloned: 'widget_cloned',
  widgetControlChanged: 'widget_control_changed',
  widgetLibraryOpened: 'widget_library_opened',
  widgetLoaded: 'widget_loaded',
  widgetLoadFailed: 'widget_load_failed',
  widgetRemoved: 'widget_removed',
  widgetSettingsOpened: 'widget_settings_opened',
  widgetSettingsSaved: 'widget_settings_saved',
  workspaceCreated: 'workspace_created',
  workspaceDeleted: 'workspace_deleted',
  workspaceDuplicated: 'workspace_duplicated',
  workspaceGroupingToggled: 'workspace_grouping_toggled',
  workspaceMoved: 'workspace_moved',
  workspaceRenamed: 'workspace_renamed',
  workspaceReordered: 'workspace_reordered',
  workspaceSwitched: 'workspace_switched',
  workspaceTemplateApplied: 'workspace_template_applied',
  aiSettingsReset: 'ai_settings_reset',
  aiSettingsSaved: 'ai_settings_saved',
} as const

let analyticsInitialized = false
let posthogClient: PostHogClient | null = null
let posthogLoadPromise: Promise<PostHogClient | null> | null = null
const pendingActions: Array<(client: PostHogClient) => void> = []

function isConfigured(): boolean {
  return Boolean(env.posthogHost && env.posthogKey)
}

function getEnvironmentName(): string {
  if (env.isProd) return 'production'
  if (env.isDev) return 'development'
  return 'unknown'
}

function getRouteProperties(): AnalyticsProperties {
  if (typeof window === 'undefined') {
    return {}
  }

  return {
    pathname: window.location.pathname,
    route: window.location.pathname,
  }
}

function sanitizeValue(value: AnalyticsValue): AnalyticsScalar | AnalyticsScalar[] | null {
  if (value === undefined || value === null) {
    return null
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item as AnalyticsValue))
      .flatMap((item) => (Array.isArray(item) ? item : item == null ? [] : [item]))
      .slice(0, 12)
    return items.length > 0 ? items : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, 200) : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean') {
    return value
  }

  return null
}

function sanitizeProperties(properties?: AnalyticsProperties): Record<string, AnalyticsScalar | AnalyticsScalar[]> {
  const sanitized = Object.entries(properties || {}).reduce<Record<string, AnalyticsScalar | AnalyticsScalar[]>>((acc, [key, value]) => {
    const nextValue = sanitizeValue(value)
    if (nextValue !== null) {
      acc[key] = nextValue
    }
    return acc
  }, {})

  return sanitized
}

function registerBaseProperties(client: PostHogClient, clientId?: string | null): void {
  const baseProperties = sanitizeProperties({
    app_name: 'vnibb',
    app_environment: getEnvironmentName(),
    auth_provider: env.authProvider,
    vnibb_client_id: clientId,
    user_state: 'anonymous',
  })

  client.register(baseProperties)
}

function flushPendingActions(): void {
  if (!posthogClient) {
    return
  }

  while (pendingActions.length > 0) {
    const action = pendingActions.shift()
    if (action) {
      action(posthogClient)
    }
  }
}

async function loadPostHog(options?: { clientId?: string | null }): Promise<PostHogClient | null> {
  if (!isConfigured() || typeof window === 'undefined') {
    return null
  }

  if (posthogClient) {
    return posthogClient
  }

  if (!posthogLoadPromise) {
    posthogLoadPromise = import('posthog-js').then(({ default: posthog }) => {
      posthogClient = posthog
      posthog.init(env.posthogKey, {
        api_host: env.posthogHost,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        disable_session_recording: true,
      })
      analyticsInitialized = true
      registerBaseProperties(posthog, options?.clientId)
      flushPendingActions()
      return posthog
    }).catch(() => {
      posthogLoadPromise = null
      return null
    })
  }

  return posthogLoadPromise
}

function withAnalyticsClient(action: (client: PostHogClient) => void): void {
  if (!isConfigured() || typeof window === 'undefined') {
    return
  }

  if (posthogClient) {
    action(posthogClient)
    return
  }

  pendingActions.push(action)
  void loadPostHog()
}

export function initAnalytics(options?: { clientId?: string | null }): void {
  if (analyticsInitialized || !isConfigured() || typeof window === 'undefined') {
    return
  }

  void loadPostHog(options)
}

export function analyticsEnabled(): boolean {
  return isConfigured() && typeof window !== 'undefined'
}

export function captureAnalyticsEvent(event: string, properties?: AnalyticsProperties): void {
  if (!analyticsEnabled()) {
    return
  }

  withAnalyticsClient((client) => {
    client.capture(event, sanitizeProperties({
      ...getRouteProperties(),
      ...properties,
    }))
  })
}

export function captureAnalyticsPageview(properties?: AnalyticsProperties): void {
  if (!analyticsEnabled() || typeof window === 'undefined') {
    return
  }

  withAnalyticsClient((client) => {
    client.capture('$pageview', sanitizeProperties({
      pathname: window.location.pathname,
      route: window.location.pathname,
      search: window.location.search,
      title: document.title,
      ...properties,
    }))
  })
}

export function identifyAnalyticsUser(user: {
  id: string
  email?: string | null
  role?: string | null
  provider?: string | null
}): void {
  if (!analyticsEnabled()) {
    return
  }

  withAnalyticsClient((client) => {
    client.identify(user.id, sanitizeProperties({
      email: user.email,
      role: user.role,
      auth_provider: user.provider,
    }))
    client.register(sanitizeProperties({
      user_state: 'authenticated',
      auth_provider: user.provider || env.authProvider,
    }))
  })
}

export function resetAnalytics(options?: { clientId?: string | null }): void {
  if (!analyticsEnabled()) {
    return
  }

  withAnalyticsClient((client) => {
    client.reset()
    registerBaseProperties(client, options?.clientId)
  })
}
