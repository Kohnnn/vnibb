// Inventory invariant for the brand widget batches (#200).
//
// The library may only offer IDs the registry can resolve, and every ID a saved
// layout or built-in template can reference must resolve too. This pins the
// union instead of the individual components.
import { widgetDefinitions } from '@/data/widgetDefinitions';
import { MAIN_TAB_TEMPLATES, TAB_WIDGET_TEMPLATES } from '@/contexts/DashboardContext/templates';
import { getRegisteredWidgetIds } from './WidgetRegistry';

const registered = new Set(getRegisteredWidgetIds());

describe('widget inventory', () => {
  test('every catalog ID resolves in the registry', () => {
    const unresolved = widgetDefinitions.map((widget) => widget.type).filter((type) => !registered.has(type));
    expect(unresolved).toEqual([]);
  });

  test('every built-in template widget ID resolves in the registry', () => {
    const templateTypes = [
      ...MAIN_TAB_TEMPLATES.flatMap((template) => template.widgets.map((widget) => widget.type as string)),
      ...Object.values(TAB_WIDGET_TEMPLATES).flatMap((template) =>
        template.map((widget) => widget.type as string),
      ),
    ];
    const unresolved = Array.from(new Set(templateTypes)).filter((type) => !registered.has(type));
    expect(unresolved).toEqual([]);
  });
});
