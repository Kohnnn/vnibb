import { WidgetEmpty } from '@/components/ui/widget-states'
import type { WidgetProps } from './WidgetRegistry'

// Saved instances stay renderable: the 40-request fanout has not passed the admission gate.
export function PositioningDashboardWidget(_props: WidgetProps) {
  return (
    <WidgetEmpty
      message="Positioning Dashboard unavailable"
      detail="Market-wide positioning is deferred until request count and source coverage pass the admission gate. Your saved dashboard layout is unchanged."
    />
  )
}

export default PositioningDashboardWidget
