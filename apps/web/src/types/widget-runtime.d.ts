import type { WidgetDataPayload as RuntimeWidgetDataPayload } from '@/lib/widgetRuntime'

declare global {
  type WidgetDataPayload = RuntimeWidgetDataPayload
}

export {}
