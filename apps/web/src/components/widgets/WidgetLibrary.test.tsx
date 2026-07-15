import { availableWidgetDefinitions, filterAvailableWidgetTypes } from './WidgetLibrary';

describe('WidgetLibrary catalog', () => {
  it('excludes placeholder-backed widgets from the add-widget catalog', () => {
    expect(availableWidgetDefinitions.some((widget) => widget.type === 'valuation_band')).toBe(false);
    expect(availableWidgetDefinitions.some((widget) => widget.type === 'price_chart')).toBe(true);
    expect(filterAvailableWidgetTypes(['valuation_band', 'price_chart'])).toEqual(['price_chart']);
  });
});
