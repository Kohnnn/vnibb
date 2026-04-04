import type { WidgetConfig, WidgetDefinition, WidgetType } from '@/types/dashboard';

const IFRAME_BASE = 'https://s3.tradingview.com/external-embedding';
const WEB_COMPONENT_BASE = 'https://www.tradingview-widget.com/w/en';

const DEFAULT_LOCALE = 'en';
const DEFAULT_INTERVAL = '1D';

const DEFAULT_MARKET_SYMBOLS = [
  'AMEX:SPY',
  'NASDAQ:QQQ',
  'TVC:DXY',
  'FX:EURUSD',
  'FX:USDVND',
  'BINANCE:BTCUSDT',
  'BINANCE:ETHUSDT',
  'TVC:GOLD',
  'TVC:USOIL',
] as const;

const DEFAULT_FOREX_CURRENCIES = ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD'];

export type TradingViewNativeWidgetType =
  | 'tradingview_chart'
  | 'tradingview_symbol_overview'
  | 'tradingview_mini_chart'
  | 'tradingview_market_summary'
  | 'tradingview_market_overview'
  | 'tradingview_stock_market'
  | 'tradingview_market_data'
  | 'tradingview_ticker_tape'
  | 'tradingview_ticker_tag'
  | 'tradingview_single_ticker'
  | 'tradingview_ticker'
  | 'tradingview_stock_heatmap'
  | 'tradingview_crypto_heatmap'
  | 'tradingview_forex_cross_rates'
  | 'tradingview_etf_heatmap'
  | 'tradingview_forex_heatmap'
  | 'tradingview_screener'
  | 'tradingview_crypto_market'
  | 'tradingview_symbol_info'
  | 'tradingview_technical_analysis'
  | 'tradingview_fundamental_data'
  | 'tradingview_company_profile'
  | 'tradingview_top_stories'
  | 'tradingview_economic_calendar'
  | 'tradingview_economic_map';

type TradingViewWidgetFormat = 'iframe' | 'web_component';
type TradingViewSymbolMode = 'widget' | 'none' | 'symbol_overview';

export interface TradingViewSettingOption {
  value: string;
  label: string;
}

export interface TradingViewSettingField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'symbol_list' | 'list' | 'color';
  section?: string;
  description?: string;
  placeholder?: string;
  options?: TradingViewSettingOption[];
  min?: number;
  step?: number;
  rows?: number;
}

interface TradingViewNativeWidgetMetadata {
  type: TradingViewNativeWidgetType;
  name: string;
  description: string;
  format: TradingViewWidgetFormat;
  scriptSrc: string;
  componentTag?: string;
  docsUrl: string;
  symbolMode: TradingViewSymbolMode;
  defaultConfig: WidgetConfig;
  defaultLayout: WidgetDefinition['defaultLayout'];
  searchKeywords?: string[];
  recommended?: boolean;
  settings: TradingViewSettingField[];
}

const LOCALE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'en', label: 'English' },
  { value: 'vi_VN', label: 'Vietnamese' },
  { value: 'ja', label: 'Japanese' },
];

const THEME_OPTIONS: TradingViewSettingOption[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const TIMEZONE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'Etc/UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
];

const INTERVAL_OPTIONS: TradingViewSettingOption[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
];

const ADVANCED_CHART_INTERVAL_OPTIONS: TradingViewSettingOption[] = [
  { value: '1', label: '1m' },
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: 'D', label: '1D' },
  { value: 'W', label: '1W' },
  { value: 'M', label: '1M' },
];

const DISPLAY_MODE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'single', label: 'Single' },
];

const ADVANCED_CHART_STYLE_OPTIONS: TradingViewSettingOption[] = [
  { value: '1', label: 'Candles' },
  { value: '2', label: 'Bars' },
  { value: '3', label: 'Line' },
  { value: '9', label: 'Area' },
];

const RANGE_OPTIONS: TradingViewSettingOption[] = [
  { value: '', label: 'Auto' },
  { value: '1D', label: '1D' },
  { value: '5D', label: '5D' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '12M', label: '12M' },
  { value: '60M', label: '5Y' },
  { value: 'ALL', label: 'All' },
];

const SCALE_POSITION_OPTIONS: TradingViewSettingOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const HEATMAP_BLOCK_SIZE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'market_cap_basic', label: 'Market Cap' },
  { value: 'market_cap_calc', label: 'Market Cap Calc' },
  { value: 'volume', label: 'Volume' },
];

const HEATMAP_BLOCK_COLOR_OPTIONS: TradingViewSettingOption[] = [
  { value: 'change', label: 'Change' },
  { value: '24h_close_change|5', label: '24h Change' },
  { value: 'performance', label: 'Performance' },
];

const FEED_MODE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'all_symbols', label: 'All Symbols' },
  { value: 'symbol', label: 'Symbol' },
];

const SYMBOL_OVERVIEW_CHART_TYPE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'area', label: 'Area' },
  { value: 'line', label: 'Line' },
  { value: 'candlesticks', label: 'Candles' },
];

const VALUES_TRACKING_OPTIONS: TradingViewSettingOption[] = [
  { value: '0', label: 'Hover' },
  { value: '1', label: 'Last Value' },
];

const CHANGE_MODE_OPTIONS: TradingViewSettingOption[] = [
  { value: 'price-and-percent', label: 'Price + %' },
  { value: 'price', label: 'Price' },
  { value: 'percent-only', label: '% Only' },
];

const IMPORTANCE_OPTIONS: TradingViewSettingOption[] = [
  { value: '0,1', label: 'Low +' },
  { value: '1,2', label: 'Medium +' },
  { value: '2,3', label: 'High +' },
  { value: '3', label: 'High Only' },
];

const COMMON_IFRAME_THEME_FIELDS: TradingViewSettingField[] = [
  { key: 'colorTheme', label: 'Color Theme', type: 'select', options: THEME_OPTIONS },
  { key: 'locale', label: 'Locale', type: 'select', options: LOCALE_OPTIONS },
  { key: 'isTransparent', label: 'Transparent', type: 'boolean' },
];

const COMMON_WEB_THEME_FIELDS: TradingViewSettingField[] = [
  { key: 'colorTheme', label: 'Color Theme', type: 'select', options: THEME_OPTIONS },
  { key: 'locale', label: 'Locale', type: 'select', options: LOCALE_OPTIONS },
];

const AUTO_SIZE_FIELDS: TradingViewSettingField[] = [
  { key: 'autosize', label: 'Auto Size', type: 'boolean' },
  { key: 'width', label: 'Width', type: 'text', placeholder: '100%' },
  { key: 'height', label: 'Height', type: 'text', placeholder: '100%' },
];

const BASE_SYMBOL_FIELDS: TradingViewSettingField[] = [
  { key: 'symbol', label: 'Symbol', type: 'text', placeholder: 'NASDAQ:AAPL' },
];

function withSection(section: string, fields: TradingViewSettingField[]): TradingViewSettingField[] {
  return fields.map((field) => ({ ...field, section }));
}

const TRADINGVIEW_WIDGETS: readonly TradingViewNativeWidgetMetadata[] = [
  {
    type: 'tradingview_chart',
    name: 'Advanced Chart',
    description: 'TradingView advanced chart with indicators, comparisons, and watchlist support.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-advanced-chart.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:QQQ',
      autosize: true,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: DEFAULT_LOCALE,
      allow_symbol_change: true,
      backgroundColor: '#0f172a',
      gridColor: 'rgba(148, 163, 184, 0.08)',
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      hide_volume: false,
      hide_legend: false,
      withdateranges: true,
      range: '',
      extended_hours: false,
      details: false,
      hotlist: false,
      calendar: false,
      hideideasbutton: false,
      save_image: true,
      studies: [],
      compareSymbols: [],
      watchlist: [],
      show_popup_button: false,
      popup_width: '1000',
      popup_height: '650',
      support_host: 'https://www.tradingview.com',
    },
    defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
    recommended: true,
    searchKeywords: ['advanced', 'chart', 'tv', 'tradingview', 'macro', 'forex', 'crypto'],
    settings: [
      ...withSection('General', [
        ...BASE_SYMBOL_FIELDS,
        { key: 'interval', label: 'Default Interval', type: 'select', options: ADVANCED_CHART_INTERVAL_OPTIONS },
        { key: 'timezone', label: 'Timezone', type: 'select', options: TIMEZONE_OPTIONS },
        { key: 'theme', label: 'Theme', type: 'select', options: THEME_OPTIONS },
        { key: 'locale', label: 'Locale', type: 'select', options: LOCALE_OPTIONS },
      ]),
      ...withSection('Chart', [
        { key: 'style', label: "Bar's Style", type: 'select', options: ADVANCED_CHART_STYLE_OPTIONS },
        { key: 'backgroundColor', label: 'Chart Background', type: 'color', placeholder: '#0f172a' },
        { key: 'gridColor', label: 'Grid', type: 'color', placeholder: 'rgba(148, 163, 184, 0.08)' },
        { key: 'range', label: 'Default Range', type: 'select', options: RANGE_OPTIONS },
        { key: 'autosize', label: 'Auto Size', type: 'boolean' },
        { key: 'width', label: 'Width', type: 'text', placeholder: '100%' },
        { key: 'height', label: 'Height', type: 'text', placeholder: '100%' },
        { key: 'hide_volume', label: 'Hide Volume', type: 'boolean' },
        { key: 'withdateranges', label: 'Show Date Ranges', type: 'boolean' },
        { key: 'extended_hours', label: 'Extended Hours', type: 'boolean' },
      ]),
      ...withSection('Add Indicators', [
        {
          key: 'studies',
          label: 'Indicators',
          type: 'list',
          rows: 4,
          placeholder: 'One TradingView study ID per line',
          description: 'Use one indicator ID per line. Advanced JSON still supports full TradingView study payloads.',
        },
      ]),
      ...withSection('Add Symbols To Compare', [
        {
          key: 'compareSymbols',
          label: 'Compare Symbols',
          type: 'list',
          rows: 4,
          placeholder: 'NASDAQ:QQQ\nAMEX:SPY',
          description: 'Add one symbol per line. Advanced JSON can be used if you need richer compare payloads.',
        },
      ]),
      ...withSection('Add Watchlist', [
        {
          key: 'watchlist',
          label: 'Watchlist Symbols',
          type: 'list',
          rows: 5,
          placeholder: 'NASDAQ:AAPL\nNASDAQ:NVDA',
        },
      ]),
      ...withSection('Additional Options', [
        { key: 'allow_symbol_change', label: 'Allow Symbol Change', type: 'boolean' },
        { key: 'hide_top_toolbar', label: 'Hide Top Toolbar', type: 'boolean' },
        { key: 'hide_side_toolbar', label: 'Hide Side Toolbar', type: 'boolean' },
        { key: 'hide_legend', label: 'Hide Legend', type: 'boolean' },
        { key: 'details', label: 'Show Details', type: 'boolean' },
        { key: 'calendar', label: 'Show Calendar', type: 'boolean' },
        { key: 'hotlist', label: 'Show Hotlist', type: 'boolean' },
        { key: 'hideideasbutton', label: 'Hide Ideas Button', type: 'boolean' },
        { key: 'save_image', label: 'Allow Save Image', type: 'boolean' },
        { key: 'show_popup_button', label: 'Show Popup Button', type: 'boolean' },
        { key: 'popup_width', label: 'Popup Width', type: 'number', min: 300, step: 10 },
        { key: 'popup_height', label: 'Popup Height', type: 'number', min: 300, step: 10 },
      ]),
    ],
  },
  {
    type: 'tradingview_symbol_overview',
    name: 'Symbol Overview',
    description: 'Compact quote and chart panel for one or more symbols.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-symbol-overview.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/charts/symbol-overview/',
    symbolMode: 'symbol_overview',
    defaultConfig: {
      autosize: true,
      chartOnly: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: 'right',
      scaleMode: 'Normal',
      fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
      fontSize: '10',
      noTimeScale: false,
      chartType: 'area',
      valuesTracking: '0',
      changeMode: 'price-and-percent',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 10, h: 7, minW: 7, minH: 5 },
    searchKeywords: ['symbol overview', 'quote', 'snapshot', 'overview'],
    settings: [
      ...withSection('General', [
        { key: 'chartOnly', label: 'Chart Only', type: 'boolean' },
        { key: 'hideDateRanges', label: 'Hide Date Ranges', type: 'boolean' },
        { key: 'hideMarketStatus', label: 'Hide Market Status', type: 'boolean' },
        { key: 'hideSymbolLogo', label: 'Hide Symbol Logo', type: 'boolean' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
      ...withSection('Chart', [
        { key: 'scalePosition', label: 'Scale Position', type: 'select', options: SCALE_POSITION_OPTIONS },
        { key: 'scaleMode', label: 'Scale Mode', type: 'text', placeholder: 'Normal' },
        { key: 'chartType', label: 'Chart Type', type: 'select', options: SYMBOL_OVERVIEW_CHART_TYPE_OPTIONS },
        { key: 'valuesTracking', label: 'Values Tracking', type: 'select', options: VALUES_TRACKING_OPTIONS },
        { key: 'changeMode', label: 'Change Mode', type: 'select', options: CHANGE_MODE_OPTIONS },
        { key: 'fontSize', label: 'Font Size', type: 'number', min: 8, step: 1 },
        { key: 'fontFamily', label: 'Font Family', type: 'text' },
        { key: 'noTimeScale', label: 'Hide Time Scale', type: 'boolean' },
        { key: 'backgroundColor', label: 'Background', type: 'color' },
        { key: 'gridLineColor', label: 'Grid', type: 'color' },
        { key: 'fontColor', label: 'Font Color', type: 'color' },
        { key: 'widgetFontColor', label: 'Widget Font Color', type: 'color' },
      ]),
    ],
  },
  {
    type: 'tradingview_mini_chart',
    name: 'Mini Chart',
    description: 'Small TradingView mini chart for quick trend checks.',
    format: 'web_component',
    scriptSrc: `${WEB_COMPONENT_BASE}/tv-mini-chart.js`,
    componentTag: 'tv-mini-chart',
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/charts/mini-chart/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:QQQ',
      dateRange: '12M',
      width: '100%',
      height: '100%',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      isTransparent: true,
      largeChartUrl: '',
    },
    defaultLayout: { w: 6, h: 4, minW: 4, minH: 3 },
    searchKeywords: ['mini chart', 'micro chart', 'sparkline'],
    settings: [
      ...BASE_SYMBOL_FIELDS,
      { key: 'dateRange', label: 'Date Range', type: 'text', placeholder: '12M' },
      ...COMMON_WEB_THEME_FIELDS,
      { key: 'isTransparent', label: 'Transparent', type: 'boolean' },
      { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
      ...AUTO_SIZE_FIELDS,
    ],
  },
  {
    type: 'tradingview_market_summary',
    name: 'Market Summary',
    description: 'Tabbed market summary widget with broad cross-asset context.',
    format: 'web_component',
    scriptSrc: `${WEB_COMPONENT_BASE}/tv-market-summary.js`,
    componentTag: 'tv-market-summary',
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/watchlists/market-summary/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 12, h: 8, minW: 8, minH: 6 },
    searchKeywords: ['market summary', 'overview', 'watchlist', 'tabs'],
    settings: [...COMMON_WEB_THEME_FIELDS, ...AUTO_SIZE_FIELDS],
  },
  {
    type: 'tradingview_market_overview',
    name: 'Market Overview',
    description: 'TradingView market overview with built-in market tabs and optional mini charts.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-market-overview.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/watchlists/market-overview/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      dateRange: '12M',
      showChart: true,
      showSymbolLogo: true,
      showFloatingTooltip: false,
      width: '100%',
      height: '100%',
      isTransparent: true,
      largeChartUrl: '',
    },
    defaultLayout: { w: 12, h: 9, minW: 8, minH: 6 },
    recommended: true,
    searchKeywords: ['market overview', 'indices', 'macro', 'tabs'],
    settings: [
      ...withSection('General', [
        { key: 'dateRange', label: 'Date Range', type: 'text', placeholder: '12M' },
        { key: 'showChart', label: 'Show Chart', type: 'boolean' },
        { key: 'showSymbolLogo', label: 'Show Symbol Logo', type: 'boolean' },
        { key: 'showFloatingTooltip', label: 'Show Floating Tooltip', type: 'boolean' },
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_stock_market',
    name: 'Stock Market',
    description: 'Top gainers, losers, and active movers for a chosen exchange.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-hotlists.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/watchlists/stock-market/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      dateRange: '12M',
      showChart: true,
      showSymbolLogo: true,
      showFloatingTooltip: false,
      exchange: 'US',
      width: '100%',
      height: '100%',
      isTransparent: true,
      largeChartUrl: '',
    },
    defaultLayout: { w: 10, h: 9, minW: 8, minH: 6 },
    searchKeywords: ['stock market', 'hotlists', 'top gainers', 'top losers'],
    settings: [
      ...withSection('General', [
        { key: 'exchange', label: 'Exchange', type: 'text', placeholder: 'US' },
        { key: 'dateRange', label: 'Date Range', type: 'text', placeholder: '12M' },
        { key: 'showChart', label: 'Show Chart', type: 'boolean' },
        { key: 'showSymbolLogo', label: 'Show Symbol Logo', type: 'boolean' },
        { key: 'showFloatingTooltip', label: 'Show Floating Tooltip', type: 'boolean' },
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_market_data',
    name: 'Market Data',
    description: 'Numerical quote table for selected instruments and market groups.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-market-quotes.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/watchlists/market-quotes/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      showSymbolLogo: false,
      width: '100%',
      height: '100%',
      isTransparent: true,
    },
    defaultLayout: { w: 10, h: 8, minW: 7, minH: 5 },
    searchKeywords: ['market data', 'market quotes', 'quotes table'],
    settings: [
      ...withSection('General', [
        { key: 'showSymbolLogo', label: 'Show Symbol Logo', type: 'boolean' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_ticker_tape',
    name: 'Ticker Tape',
    description: 'Scrolling cross-asset ticker tape for global markets.',
    format: 'web_component',
    scriptSrc: `${WEB_COMPONENT_BASE}/tv-ticker-tape.js`,
    componentTag: 'tv-ticker-tape',
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tape/',
    symbolMode: 'none',
    defaultConfig: {
      symbols: [...DEFAULT_MARKET_SYMBOLS],
      direction: 'horizontal',
      itemSize: 'regular',
      showSymbolLogo: true,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 24, h: 4, minW: 12, minH: 3 },
    recommended: true,
    searchKeywords: ['ticker tape', 'tape', 'ticker'],
    settings: [
      { key: 'symbols', label: 'Symbols', type: 'symbol_list', description: 'One symbol per line.' },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        options: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
        ],
      },
      {
        key: 'itemSize',
        label: 'Item Size',
        type: 'select',
        options: [
          { value: 'regular', label: 'Regular' },
          { value: 'compact', label: 'Compact' },
        ],
      },
      { key: 'showSymbolLogo', label: 'Show Symbol Logo', type: 'boolean' },
      ...COMMON_WEB_THEME_FIELDS,
    ],
  },
  {
    type: 'tradingview_ticker_tag',
    name: 'Ticker Tag',
    description: 'Inline ticker pill with hover chart popover.',
    format: 'web_component',
    scriptSrc: `${WEB_COMPONENT_BASE}/tv-ticker-tag.js`,
    componentTag: 'tv-ticker-tag',
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tag/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:AAPL',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 },
    searchKeywords: ['ticker tag', 'inline quote', 'pill'],
    settings: [...BASE_SYMBOL_FIELDS, ...COMMON_WEB_THEME_FIELDS],
  },
  {
    type: 'tradingview_single_ticker',
    name: 'Single Ticker',
    description: 'Single-symbol quote card with latest change.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-single-quote.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/tickers/single-ticker/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'FX:EURUSD',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      isTransparent: true,
      largeChartUrl: '',
    },
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    searchKeywords: ['single ticker', 'single quote'],
    settings: [...BASE_SYMBOL_FIELDS, { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text' }, ...COMMON_IFRAME_THEME_FIELDS],
  },
  {
    type: 'tradingview_ticker',
    name: 'Ticker',
    description: 'Horizontal instrument summary strip with up to 15 symbols.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-tickers.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/tickers/ticker/',
    symbolMode: 'none',
    defaultConfig: {
      symbols: [...DEFAULT_MARKET_SYMBOLS.slice(0, 6)],
      timeframe: '12M',
      showSymbolLogo: true,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      isTransparent: true,
      largeChartUrl: '',
    },
    defaultLayout: { w: 12, h: 4, minW: 8, minH: 3 },
    searchKeywords: ['ticker strip', 'quotes strip', 'multi ticker'],
    settings: [
      { key: 'symbols', label: 'Symbols', type: 'symbol_list' },
      { key: 'timeframe', label: 'Timeframe', type: 'text', placeholder: '12M' },
      { key: 'showSymbolLogo', label: 'Show Symbol Logo', type: 'boolean' },
      { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text' },
      ...COMMON_IFRAME_THEME_FIELDS,
    ],
  },
  {
    type: 'tradingview_stock_heatmap',
    name: 'Stock Heatmap',
    description: 'Treemap heatmap for equities by sector, market cap, and performance.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-stock-heatmap.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/heatmaps/stock-heatmap/',
    symbolMode: 'none',
    defaultConfig: {
      autosize: true,
      dataSource: 'SPX500',
      exchanges: [],
      grouping: 'sector',
      blockSize: 'market_cap_basic',
      blockColor: 'change',
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      symbolUrl: '',
      isMonoSize: false,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 12, h: 10, minW: 8, minH: 7 },
    searchKeywords: ['stock heatmap', 'treemap', 'sector heatmap'],
    settings: [
      { key: 'dataSource', label: 'Data Source', type: 'text', placeholder: 'SPX500' },
      { key: 'grouping', label: 'Grouping', type: 'text', placeholder: 'sector' },
      { key: 'blockSize', label: 'Block Size', type: 'select', options: HEATMAP_BLOCK_SIZE_OPTIONS },
      { key: 'blockColor', label: 'Block Color', type: 'select', options: HEATMAP_BLOCK_COLOR_OPTIONS },
      { key: 'autosize', label: 'Auto Size', type: 'boolean' },
      { key: 'hasTopBar', label: 'Show Top Bar', type: 'boolean' },
      { key: 'isDataSetEnabled', label: 'Enable Data Set Switch', type: 'boolean' },
      { key: 'isZoomEnabled', label: 'Enable Zoom', type: 'boolean' },
      { key: 'hasSymbolTooltip', label: 'Show Symbol Tooltip', type: 'boolean' },
      { key: 'isMonoSize', label: 'Mono Size', type: 'boolean' },
      ...COMMON_IFRAME_THEME_FIELDS,
    ],
  },
  {
    type: 'tradingview_crypto_heatmap',
    name: 'Crypto Coins Heatmap',
    description: 'Treemap heatmap for crypto assets and performance clusters.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-crypto-coins-heatmap.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/heatmaps/crypto-heatmap/',
    symbolMode: 'none',
    defaultConfig: {
      autosize: true,
      dataSource: 'Crypto',
      blockSize: 'market_cap_calc',
      blockColor: '24h_close_change|5',
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      symbolUrl: '',
      isMonoSize: false,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 12, h: 10, minW: 8, minH: 7 },
    searchKeywords: ['crypto heatmap', 'coins heatmap', 'treemap'],
    settings: [
      { key: 'blockSize', label: 'Block Size', type: 'select', options: HEATMAP_BLOCK_SIZE_OPTIONS },
      { key: 'blockColor', label: 'Block Color', type: 'select', options: HEATMAP_BLOCK_COLOR_OPTIONS },
      { key: 'autosize', label: 'Auto Size', type: 'boolean' },
      { key: 'hasTopBar', label: 'Show Top Bar', type: 'boolean' },
      { key: 'isDataSetEnabled', label: 'Enable Data Set Switch', type: 'boolean' },
      { key: 'isZoomEnabled', label: 'Enable Zoom', type: 'boolean' },
      { key: 'hasSymbolTooltip', label: 'Show Symbol Tooltip', type: 'boolean' },
      { key: 'isMonoSize', label: 'Mono Size', type: 'boolean' },
      ...COMMON_IFRAME_THEME_FIELDS,
    ],
  },
  {
    type: 'tradingview_forex_cross_rates',
    name: 'Forex Cross Rates',
    description: 'Matrix of currency pair rates across selected base currencies.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-forex-cross-rates.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/heatmaps/forex-cross-rates/',
    symbolMode: 'none',
    defaultConfig: {
      currencies: [...DEFAULT_FOREX_CURRENCIES],
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
      isTransparent: true,
      autosize: true,
      backgroundColor: 'rgba(15, 23, 42, 1)',
      largeChartUrl: '',
    },
    defaultLayout: { w: 10, h: 8, minW: 7, minH: 5 },
    searchKeywords: ['forex cross rates', 'fx matrix', 'currency matrix'],
    settings: [
      { key: 'currencies', label: 'Currencies', type: 'symbol_list' },
      { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text' },
      ...COMMON_IFRAME_THEME_FIELDS,
      ...AUTO_SIZE_FIELDS,
    ],
  },
  {
    type: 'tradingview_etf_heatmap',
    name: 'ETF Heatmap',
    description: 'ETF-focused treemap heatmap with block sizing and grouping options.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-etf-heatmap.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/heatmaps/etf-heatmap/',
    symbolMode: 'none',
    defaultConfig: {
      autosize: true,
      dataSource: 'AllUSEtf',
      blockSize: 'volume',
      blockColor: 'change',
      grouping: 'asset_class',
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      symbolUrl: '',
      isMonoSize: false,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
    },
    defaultLayout: { w: 12, h: 10, minW: 8, minH: 7 },
    searchKeywords: ['etf heatmap', 'etf treemap'],
    settings: [
      { key: 'dataSource', label: 'Data Source', type: 'text', placeholder: 'AllUSEtf' },
      { key: 'grouping', label: 'Grouping', type: 'text', placeholder: 'asset_class' },
      { key: 'blockSize', label: 'Block Size', type: 'select', options: HEATMAP_BLOCK_SIZE_OPTIONS },
      { key: 'blockColor', label: 'Block Color', type: 'select', options: HEATMAP_BLOCK_COLOR_OPTIONS },
      { key: 'autosize', label: 'Auto Size', type: 'boolean' },
      { key: 'hasTopBar', label: 'Show Top Bar', type: 'boolean' },
      { key: 'isDataSetEnabled', label: 'Enable Data Set Switch', type: 'boolean' },
      { key: 'isZoomEnabled', label: 'Enable Zoom', type: 'boolean' },
      { key: 'hasSymbolTooltip', label: 'Show Symbol Tooltip', type: 'boolean' },
      { key: 'isMonoSize', label: 'Mono Size', type: 'boolean' },
      ...COMMON_IFRAME_THEME_FIELDS,
    ],
  },
  {
    type: 'tradingview_forex_heatmap',
    name: 'Forex Heatmap',
    description: 'Heatmap view of relative currency strength across selected currencies.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-forex-heat-map.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/heatmaps/forex-heatmap/',
    symbolMode: 'none',
    defaultConfig: {
      currencies: [...DEFAULT_FOREX_CURRENCIES, 'CNY'],
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
      isTransparent: true,
      autosize: true,
      backgroundColor: 'rgba(15, 23, 42, 1)',
      largeChartUrl: '',
    },
    defaultLayout: { w: 10, h: 8, minW: 7, minH: 5 },
    searchKeywords: ['forex heatmap', 'currency heatmap'],
    settings: [
      { key: 'currencies', label: 'Currencies', type: 'symbol_list' },
      { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text' },
      ...COMMON_IFRAME_THEME_FIELDS,
      ...AUTO_SIZE_FIELDS,
    ],
  },
  {
    type: 'tradingview_screener',
    name: 'Screener',
    description: 'TradingView screener for stock, forex, or crypto pair scans.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-screener.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/screeners/screener/',
    symbolMode: 'none',
    defaultConfig: {
      defaultColumn: 'overview',
      defaultScreen: 'general',
      market: 'forex',
      showToolbar: true,
      isTransparent: true,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 14, h: 10, minW: 10, minH: 7 },
    searchKeywords: ['tradingview screener', 'screener', 'scanner'],
    settings: [
      { key: 'market', label: 'Market', type: 'text', placeholder: 'forex' },
      { key: 'defaultColumn', label: 'Default Column', type: 'text', placeholder: 'overview' },
      { key: 'defaultScreen', label: 'Default Screen', type: 'text', placeholder: 'general' },
      { key: 'showToolbar', label: 'Show Toolbar', type: 'boolean' },
      ...COMMON_IFRAME_THEME_FIELDS,
      ...AUTO_SIZE_FIELDS,
    ],
  },
  {
    type: 'tradingview_crypto_market',
    name: 'Cryptocurrency Market',
    description: 'TradingView crypto market screener sorted by market capitalization.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-screener.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/screeners/crypto-mkt-screener/',
    symbolMode: 'none',
    defaultConfig: {
      defaultColumn: 'overview',
      market: 'crypto',
      screener_type: 'crypto_mkt',
      displayCurrency: 'USD',
      isTransparent: true,
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 14, h: 10, minW: 10, minH: 7 },
    searchKeywords: ['crypto market', 'crypto screener', 'market cap'],
    settings: [
      { key: 'defaultColumn', label: 'Default Column', type: 'text', placeholder: 'overview' },
      { key: 'displayCurrency', label: 'Display Currency', type: 'text', placeholder: 'USD' },
      ...COMMON_IFRAME_THEME_FIELDS,
      ...AUTO_SIZE_FIELDS,
    ],
  },
  {
    type: 'tradingview_symbol_info',
    name: 'Symbol Info',
    description: 'Essential current quote and reference data for a specific asset.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-symbol-info.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/symbol-details/symbol-info/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:AAPL',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      isTransparent: true,
    },
    defaultLayout: { w: 8, h: 4, minW: 5, minH: 3 },
    searchKeywords: ['symbol info', 'quote info', 'symbol snapshot'],
    settings: [
      ...withSection('General', [
        ...BASE_SYMBOL_FIELDS,
        { key: 'autosize', label: 'Auto Size', type: 'boolean' },
        { key: 'width', label: 'Width', type: 'text', placeholder: '100%' },
        { key: 'height', label: 'Height', type: 'text', placeholder: '203' },
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
        ...COMMON_IFRAME_THEME_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_technical_analysis',
    name: 'Technical Analysis',
    description: 'TradingView technical rating gauge for the selected symbol.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-technical-analysis.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/symbol-details/technical-analysis/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:QQQ',
      interval: DEFAULT_INTERVAL,
      width: '100%',
      height: '100%',
      isTransparent: true,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: DEFAULT_LOCALE,
      colorTheme: 'dark',
    },
    defaultLayout: { w: 9, h: 10, minW: 8, minH: 8 },
    recommended: true,
    searchKeywords: ['technical analysis', 'gauge', 'signals'],
    settings: [
      ...withSection('General', [
        ...BASE_SYMBOL_FIELDS,
        { key: 'interval', label: 'Interval', type: 'select', options: INTERVAL_OPTIONS },
        { key: 'displayMode', label: 'Display Mode', type: 'select', options: DISPLAY_MODE_OPTIONS },
        { key: 'showIntervalTabs', label: 'Show Interval Tabs', type: 'boolean' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_fundamental_data',
    name: 'Fundamental Data',
    description: 'Fundamental data and financial metrics for a single company.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-financials.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/symbol-details/fundamental-data/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:AAPL',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      isTransparent: true,
      autosize: true,
      displayMode: 'adaptive',
      width: '100%',
      height: '100%',
      largeChartUrl: '',
    },
    defaultLayout: { w: 10, h: 9, minW: 8, minH: 6 },
    searchKeywords: ['fundamental data', 'financials', 'company fundamentals'],
    settings: [
      ...withSection('General', [
        ...BASE_SYMBOL_FIELDS,
        { key: 'displayMode', label: 'Display Mode', type: 'select', options: DISPLAY_MODE_OPTIONS },
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
      ...withSection('Data Fields', [
        {
          key: 'columns',
          label: 'Columns',
          type: 'list',
          rows: 4,
          placeholder: 'One column key per line',
          description: 'Optional TradingView financial column keys. Leave blank to use the default field set.',
        },
        {
          key: 'fieldGroups',
          label: 'Field Groups',
          type: 'list',
          rows: 3,
          placeholder: 'One field group key per line',
        },
      ]),
    ],
  },
  {
    type: 'tradingview_company_profile',
    name: 'Company Profile',
    description: 'Business description, sector, and industry panel from TradingView.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-symbol-profile.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/symbol-details/company-profile/',
    symbolMode: 'widget',
    defaultConfig: {
      symbol: 'NASDAQ:AAPL',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      isTransparent: true,
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 },
    searchKeywords: ['company profile', 'business description', 'industry'],
    settings: [
      ...withSection('General', [
        ...BASE_SYMBOL_FIELDS,
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_top_stories',
    name: 'Top Stories',
    description: 'TradingView news feed for all symbols or a specific symbol.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-timeline.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/news/top-stories/',
    symbolMode: 'widget',
    defaultConfig: {
      feedMode: 'all_symbols',
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      isTransparent: true,
      autosize: true,
      displayMode: 'regular',
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
    searchKeywords: ['top stories', 'news', 'timeline'],
    settings: [
      ...withSection('General', [
        { key: 'feedMode', label: 'Feed Mode', type: 'select', options: FEED_MODE_OPTIONS },
        ...BASE_SYMBOL_FIELDS,
        { key: 'market', label: 'Market', type: 'text', placeholder: 'stock' },
        { key: 'displayMode', label: 'Display Mode', type: 'select', options: DISPLAY_MODE_OPTIONS },
        { key: 'largeChartUrl', label: 'Large Chart URL', type: 'text', placeholder: 'https://...' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_economic_calendar',
    name: 'Economic Calendar',
    description: 'Upcoming macro events with country, currency, and importance filters.',
    format: 'iframe',
    scriptSrc: `${IFRAME_BASE}/embed-widget-events.js`,
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/calendars/economic-calendar/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
      isTransparent: true,
      autosize: true,
      hideImportanceIndicator: false,
    },
    defaultLayout: { w: 10, h: 9, minW: 8, minH: 6 },
    searchKeywords: ['economic calendar', 'macro events', 'calendar'],
    settings: [
      ...withSection('General', [
        { key: 'countryFilter', label: 'Country Filter', type: 'text', placeholder: 'US,VN,EU' },
        { key: 'currencyFilter', label: 'Currency Filter', type: 'text', placeholder: 'USD,EUR,JPY' },
        { key: 'importanceFilter', label: 'Importance', type: 'select', options: IMPORTANCE_OPTIONS },
        { key: 'hideImportanceIndicator', label: 'Hide Importance Indicator', type: 'boolean' },
        ...COMMON_IFRAME_THEME_FIELDS,
        ...AUTO_SIZE_FIELDS,
      ]),
    ],
  },
  {
    type: 'tradingview_economic_map',
    name: 'Economic Map',
    description: 'Geographic macro map for key global economic indicators.',
    format: 'web_component',
    scriptSrc: `${WEB_COMPONENT_BASE}/tv-economic-map.js`,
    componentTag: 'tv-economic-map',
    docsUrl: 'https://www.tradingview.com/widget-docs/widgets/economics/economic-map/',
    symbolMode: 'none',
    defaultConfig: {
      colorTheme: 'dark',
      locale: DEFAULT_LOCALE,
      width: '100%',
      height: '100%',
    },
    defaultLayout: { w: 12, h: 9, minW: 8, minH: 6 },
    searchKeywords: ['economic map', 'macro map', 'world map'],
    settings: [...COMMON_WEB_THEME_FIELDS, ...AUTO_SIZE_FIELDS],
  },
] as const;

export function isTradingViewWidget(type: WidgetType | string | null | undefined): type is TradingViewNativeWidgetType {
  return TRADINGVIEW_WIDGETS.some((widget) => widget.type === type);
}

export function getTradingViewWidgetMetadata(type: WidgetType | string | null | undefined): TradingViewNativeWidgetMetadata | null {
  if (!type) return null;
  return TRADINGVIEW_WIDGETS.find((widget) => widget.type === type) ?? null;
}

export function getTradingViewSettingsFields(type: WidgetType | string | null | undefined): TradingViewSettingField[] {
  return getTradingViewWidgetMetadata(type)?.settings ?? [];
}

export function getTradingViewDefaultConfig(type: WidgetType | string | null | undefined): WidgetConfig {
  const metadata = getTradingViewWidgetMetadata(type);
  return metadata ? { ...metadata.defaultConfig } : {};
}

export function usesTradingViewWidgetSymbol(type: WidgetType | string | null | undefined): boolean {
  const symbolMode = getTradingViewWidgetMetadata(type)?.symbolMode;
  return symbolMode === 'widget' || symbolMode === 'symbol_overview';
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeSymbolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object' && 'proName' in entry) {
          return toText((entry as { proName?: unknown }).proName).trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function buildSymbolOverviewSymbols(symbol: string): string[][] {
  const normalized = symbol.trim();
  if (!normalized) return [];
  const label = normalized.split(':').pop() || normalized;
  return [[label, `${normalized}|1D`]];
}

function toIframeMultiSymbolObjects(symbols: string[]): Array<{ description: string; proName: string }> {
  return symbols.map((symbol) => ({ description: '', proName: symbol }));
}

export function buildTradingViewRuntimeConfig(
  type: WidgetType | string | null | undefined,
  config: WidgetConfig | undefined,
  symbol: string | undefined,
): WidgetConfig {
  const metadata = getTradingViewWidgetMetadata(type);
  if (!metadata) return { ...(config || {}) };

  const merged: WidgetConfig = {
    ...metadata.defaultConfig,
    ...(config || {}),
  };

  if (metadata.symbolMode === 'widget' && symbol) {
    merged.symbol = symbol;
  }

  if (type === 'tradingview_symbol_overview') {
    const configuredSymbols = Array.isArray(merged.symbols) ? merged.symbols : [];
    merged.symbols = configuredSymbols.length > 0 ? configuredSymbols : buildSymbolOverviewSymbols(symbol || 'NASDAQ:AAPL');
    delete merged.symbol;
  }

  if (type === 'tradingview_ticker') {
    const symbolsList = normalizeSymbolList(merged.symbols);
    merged.symbols = toIframeMultiSymbolObjects(symbolsList.length > 0 ? symbolsList : [...DEFAULT_MARKET_SYMBOLS.slice(0, 6)]);
  }

  if (type === 'tradingview_top_stories') {
    if (merged.feedMode === 'symbol' && symbol) {
      merged.symbol = symbol;
    }
    if (merged.feedMode !== 'symbol') {
      delete merged.symbol;
    }
  }

  if (type === 'tradingview_crypto_market') {
    merged.market = 'crypto';
    merged.screener_type = 'crypto_mkt';
  }

  return merged;
}

export function buildTradingViewWebComponentAttributes(
  type: WidgetType | string | null | undefined,
  config: WidgetConfig | undefined,
  symbol: string | undefined,
): Record<string, string> {
  const metadata = getTradingViewWidgetMetadata(type);
  if (!metadata) return {};

  const runtimeConfig = buildTradingViewRuntimeConfig(type, config, symbol);
  const attributes: Record<string, string> = {};

  Object.entries(runtimeConfig).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;

    if (key === 'symbols') {
      const symbolList = normalizeSymbolList(value);
      if (symbolList.length > 0) {
        attributes.symbols = symbolList.join(',');
      }
      return;
    }

    if (Array.isArray(value) || (value && typeof value === 'object')) {
      attributes[key] = JSON.stringify(value);
      return;
    }

    attributes[key] = String(value);
  });

  return attributes;
}

export const tradingViewCatalogEntries: WidgetDefinition[] = TRADINGVIEW_WIDGETS.map((widget) => ({
  type: widget.type,
  name: widget.name,
  description: widget.description,
  category: 'global_markets',
  defaultConfig: { ...widget.defaultConfig },
  defaultLayout: widget.defaultLayout,
  recommended: widget.recommended,
  searchKeywords: widget.searchKeywords,
}));

export const tradingViewWidgetDefaultLayouts = Object.fromEntries(
  TRADINGVIEW_WIDGETS.map((widget) => [widget.type, widget.defaultLayout]),
) as Record<TradingViewNativeWidgetType, WidgetDefinition['defaultLayout']>;

export const tradingViewWidgetNames = Object.fromEntries(
  TRADINGVIEW_WIDGETS.map((widget) => [widget.type, widget.name]),
) as Record<TradingViewNativeWidgetType, string>;

export const tradingViewWidgetDescriptions = Object.fromEntries(
  TRADINGVIEW_WIDGETS.map((widget) => [widget.type, widget.description]),
) as Record<TradingViewNativeWidgetType, string>;
