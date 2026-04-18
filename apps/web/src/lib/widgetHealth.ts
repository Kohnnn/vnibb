'use client'

export type WidgetHealthStatus =
  | 'cached'
  | 'stale'
  | 'limited'
  | 'coverage_gap'
  | 'awaiting_update'

export interface WidgetHealthState {
  status: WidgetHealthStatus
  label: string
  detail?: string
}
