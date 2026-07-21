import { availableWidgetDefinitions, filterAvailableWidgetTypes } from './WidgetLibrary';

describe('WidgetLibrary catalog', () => {
  it('includes only activated Wave 12 widgets while excluding other placeholders', () => {
    const activated = ['bank_metrics', 'valuation_band', 'cashflow_waterfall', 'technical_summary'];
    expect(activated.every((type) => availableWidgetDefinitions.some((widget) => widget.type === type))).toBe(true);
    expect(filterAvailableWidgetTypes([...activated, 'valuation_multiples_chart'] as never)).toEqual(activated);
  });

  it('includes the five activated Wave 9.6 market-analysis widgets', () => {
    const types = ['transaction_flow', 'industry_bubble', 'sector_board', 'money_flow_trend', 'correlation_matrix'];
    expect(types.every((type) => availableWidgetDefinitions.some((widget) => widget.type === type))).toBe(true);
    expect(filterAvailableWidgetTypes(types as never)).toEqual(types);
  });
});
