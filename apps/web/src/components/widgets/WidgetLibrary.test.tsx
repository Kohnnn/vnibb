import { availableWidgetDefinitions, filterAvailableWidgetTypes } from './WidgetLibrary';

describe('WidgetLibrary catalog', () => {
  it('exposes activated valuation charts alongside other implemented widgets', () => {
    const activated = ['bank_metrics', 'valuation_band', 'cashflow_waterfall', 'technical_summary', 'valuation_multiples_chart'];
    expect(activated.every((type) => availableWidgetDefinitions.some((widget) => widget.type === type))).toBe(true);
    expect(filterAvailableWidgetTypes(activated as never)).toEqual(activated);
  });

  it('includes the five activated Wave 9.6 market-analysis widgets', () => {
    const types = ['transaction_flow', 'industry_bubble', 'sector_board', 'money_flow_trend', 'correlation_matrix'];
    expect(types.every((type) => availableWidgetDefinitions.some((widget) => widget.type === type))).toBe(true);
    expect(filterAvailableWidgetTypes(types as never)).toEqual(types);
  });
});
