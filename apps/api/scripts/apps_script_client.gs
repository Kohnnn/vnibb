/**
 * ============================================================================
 * VNIBB Google Apps Script Client — Vietnamese Stock Data for Google Sheets
 * ============================================================================
 *
 * WHAT THIS IS
 * ------------
 * A Google Apps Script (server-side JavaScript, ES5-style, runs on Google's
 * infrastructure) that pulls live Vietnamese stock-market data from the VNIBB
 * FastAPI backend and writes it into Google Sheets tabs. Financial statements
 * are the primary use case; screener, ratios, quotes, historical prices,
 * listings, and market indices are also supported.
 *
 * DATA SOURCE
 * -----------
 * VNIBB exposes a dedicated read-only API group at `/api/v1/apps-script`.
 * Every endpoint returns FLAT JSON (a JSON array of flat objects, or a single
 * StandardResponse wrapper for /quote) so it maps directly onto sheet rows
 * without post-processing. All endpoints require an `X-API-Key` header whose
 * value must equal the server's `VNIBB_APPS_SCRIPT_KEY` environment variable.
 *
 * ENDPOINT CONTRACT (server: apps_script.py)
 * ------------------------------------------
 *   GET /financials/{symbol}?statement_type=income|balance|cashflow
 *                           &period=year|quarter&limit=1..20
 *        -> [ {flat statement row per period}, ... ]   (PRIMARY)
 *   GET /ratios/{symbol}?period=year|quarter
 *        -> [ {one flat row of ~84 metrics} ]
 *   GET /screener?exchange=HOSE|HNX|UPCOM|ALL&industry=&limit=1..2000&source=KBS
 *        -> [ {flat row of 84 metrics per ticker}, ... ]
 *   GET /historical/{symbol}?start_date=YYYY-MM-DD (REQUIRED)
 *                           &end_date=YYYY-MM-DD&interval=1D|1W|1M
 *        -> [ {date, open, high, low, close, volume, ...}, ... ]
 *   GET /quote/{symbol}?source=VCI
 *        -> { error, data: {symbol, price, change, change_pct, ...} }  (WRAPPED)
 *   GET /listing?exchange=HOSE|HNX|UPCOM|ALL
 *        -> [ {symbol, company_name, exchange, industry}, ... ]
 *   GET /market/indices
 *        -> [ {index snapshot}, ... ]
 *   GET /health
 *        -> { status, database, version }
 *
 * SETUP (two supported modes)
 * ---------------------------
 *   BOUND (recommended for a single Sheet):
 *     1. Open your Google Sheet -> Extensions -> Apps Script.
 *     2. Paste this file into Code.gs.
 *     3. Set CONFIG.baseUrl and Script Property VNIBB_APPS_SCRIPT_KEY. Leave
 *        CONFIG.apiKey and CONFIG.spreadsheetId ''.
 *     4. Save, reload the Sheet. A "VNIBB" menu appears (see onOpen).
 *
 *   STANDALONE (script.google.com, or driving another Sheet):
 *     1. script.google.com -> New project. Paste this file.
 *     2. Fill CONFIG.baseUrl, CONFIG.apiKey, AND CONFIG.spreadsheetId
 *        (the long token in the target Sheet URL: /spreadsheets/d/THIS/edit).
 *     3. Run any pull* function from the editor's function picker; approve the
 *        OAuth consent prompt on first run.
 *
 * SECURITY NOTE
 * -------------
 * This file is a TEMPLATE committed to a public repo. The CONFIG values below
 * are placeholders. Put the real host and key only in your own Apps Script
 * project (they live in Google's private script storage, not in this repo).
 * Prefer Script Properties over inline literals for the key when possible
 * (see readApiKey_ below).
 *
 * SCHEDULING
 * ----------
 * Triggers -> Add Trigger -> choose a pull* function -> Time-driven -> Hourly.
 * Good candidates: refreshFinancialDashboard (all statements for a watchlist)
 * or pullScreener (whole-exchange snapshot).
 * ============================================================================
 */

// ===========================================================================
// CONFIG — fill these in your own Apps Script project (NOT in the public repo)
// ===========================================================================

var CONFIG = {
  /**
   * Full API base for the Apps Script endpoint group, NO trailing slash.
   * Must end in /api/v1/apps-script.
   * Example: 'https://YOUR_HOST.sslip.io/api/v1/apps-script'
   */
  baseUrl: 'https://YOUR_HOST/api/v1/apps-script',

  /**
   * Secret that must match the server's VNIBB_APPS_SCRIPT_KEY env var.
   * Leave as '' here and instead store it in Script Properties
   * (Project Settings -> Script Properties -> key: VNIBB_APPS_SCRIPT_KEY)
   * so the secret never lives in code. readApiKey_() checks both.
   */
  apiKey: '',

  /**
   * Target spreadsheet ID (the long token in the Sheet URL:
   * https://docs.google.com/spreadsheets/d/THIS_PART/edit).
   * Leave '' when BOUND (script created from inside a Sheet).
   * REQUIRED when STANDALONE (script.google.com).
   */
  spreadsheetId: '',

  /** Default watchlist used by refreshFinancialDashboard(). */
  watchlist: ['VNM', 'FPT', 'TCB', 'HPG', 'MWG'],

  /** HTTP behaviour. */
  timeoutRetries: 3,        // attempts on 5xx / transient network errors
  retryBackoffMs: 1500,     // base backoff; grows linearly per attempt
  requestTimeoutNote: 30,   // server middleware timeout in seconds (info only)
  maxSheetCells: 10000000,
};


// ===========================================================================
// Spreadsheet UI menu — appears when the bound Sheet is opened
// ===========================================================================

/**
 * Adds a "VNIBB" menu to the Sheet toolbar on open (bound mode only).
 * Standalone projects ignore this; call functions from the editor instead.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('VNIBB')
      .addItem('⚙ Open Settings Sheet', 'menuOpenSettings_')
      .addSeparator()
      .addItem('📊 Refresh Dashboard (watchlist)', 'refreshFinancialDashboard')
      .addSeparator()
      .addSubMenu(SpreadsheetApp.getUi().createMenu('Pull for symbol…')
        .addItem('All Financials (income + balance + cashflow)', 'menuPullAllFinancials_')
        .addItem('Income Statement', 'menuPullIncome_')
        .addItem('Balance Sheet', 'menuPullBalance_')
        .addItem('Cash Flow Statement', 'menuPullCashflow_')
        .addItem('Financial Ratios', 'menuPullRatios_')
        .addItem('Historical Prices (OHLCV)', 'menuPullHistorical_')
        .addItem('Live Quote', 'menuPullQuote_'))
      .addSubMenu(SpreadsheetApp.getUi().createMenu('Market data…')
        .addItem('Screener', 'menuPullScreener_')
        .addItem('Listing (symbol list)', 'menuPullListing_')
        .addItem('Market Indices', 'pullMarketIndices'))
      .addSeparator()
      .addItem('🩺 Health Check', 'vnibbHealth')
      .addToUi();
  } catch (e) {
    // getUi() throws in standalone context — safe to ignore.
  }
}

// ---------------------------------------------------------------------------
// Menu action helpers — prompt the user for a ticker, then call the pull fn.
// Each one reads defaults from the Settings sheet when available.
// ---------------------------------------------------------------------------

function menuOpenSettings_() {
  var sheet = ensureSettingsSheet_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

function menuPullAllFinancials_() {
  var s = readSettings_();
  var sym = promptTicker_('All Financials', s.defaultSymbol);
  if (!sym) return;
  pullAllFinancials(sym, s.defaultPeriod, s.defaultLimit);
}

function menuPullIncome_() {
  var s = readSettings_();
  var sym = promptTicker_('Income Statement', s.defaultSymbol);
  if (!sym) return;
  pullFinancials(sym, 'income', s.defaultPeriod, s.defaultLimit);
}

function menuPullBalance_() {
  var s = readSettings_();
  var sym = promptTicker_('Balance Sheet', s.defaultSymbol);
  if (!sym) return;
  pullFinancials(sym, 'balance', s.defaultPeriod, s.defaultLimit);
}

function menuPullCashflow_() {
  var s = readSettings_();
  var sym = promptTicker_('Cash Flow', s.defaultSymbol);
  if (!sym) return;
  pullFinancials(sym, 'cashflow', s.defaultPeriod, s.defaultLimit);
}

function menuPullRatios_() {
  var s = readSettings_();
  var sym = promptTicker_('Ratios', s.defaultSymbol);
  if (!sym) return;
  pullRatios(sym, s.defaultPeriod);
}

function menuPullHistorical_() {
  var s = readSettings_();
  var sym = promptTicker_('Historical Prices', s.defaultSymbol);
  if (!sym) return;
  pullHistorical(sym, null, null, s.defaultInterval);
}

function menuPullQuote_() {
  var s = readSettings_();
  var sym = promptTicker_('Live Quote', s.defaultSymbol);
  if (!sym) return;
  var q = pullQuote(sym);
  try {
    SpreadsheetApp.getUi().alert(sym + ' quote:\n' + JSON.stringify(q, null, 2));
  } catch (e) { /* standalone */ }
}

function menuPullScreener_() {
  var s = readSettings_();
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Screener', 'Exchange (HOSE / HNX / UPCOM / ALL):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var exch = (resp.getResponseText() || s.defaultExchange).trim().toUpperCase() || 'HOSE';
  pullScreener(exch, s.defaultLimit);
}

function menuPullListing_() {
  var s = readSettings_();
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Listing', 'Exchange (HOSE / HNX / UPCOM / ALL):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var exch = (resp.getResponseText() || s.defaultExchange).trim().toUpperCase() || 'HOSE';
  pullListing(exch);
}

/**
 * Show a prompt asking the user for a ticker symbol.
 * @param {string} context  Label shown in the dialog title.
 * @param {string} default_ Suggested default symbol.
 * @returns {string|null}   Upper-cased ticker, or null if cancelled.
 */
function promptTicker_(context, default_) {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    context,
    'Enter ticker symbol (e.g. ' + (default_ || 'VNM') + '):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  var sym = (resp.getResponseText() || '').trim().toUpperCase();
  return sym || (default_ || null);
}


// ===========================================================================
// Settings Sheet — user-editable defaults, watchlist, per-ticker overrides
// ===========================================================================

var SETTINGS_SHEET_NAME = '⚙ VNIBB Settings';

/**
 * Layout of the Settings sheet (row numbers, 1-indexed).
 * Section A: key-value pairs in columns A (key label) and B (value).
 * Section B: watchlist starting at WATCHLIST_START_ROW, column A.
 */
var SETTINGS_LAYOUT = {
  DEFAULT_SYMBOL_ROW:   2,
  DEFAULT_PERIOD_ROW:   3,
  DEFAULT_LIMIT_ROW:    4,
  DEFAULT_INTERVAL_ROW: 5,
  DEFAULT_EXCHANGE_ROW: 6,
  WATCHLIST_START_ROW:  10,
};

/**
 * Create the Settings sheet if it doesn't exist, pre-filled with defaults.
 * Idempotent: safe to call repeatedly.
 * @returns {Sheet}
 */
function ensureSettingsSheet_() {
  var ss = resolveSpreadsheet_();
  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SETTINGS_SHEET_NAME, 0); // insert as first tab

  // ---- Section header ----
  sheet.getRange('A1:B1').setValues([['⚙ VNIBB Settings', '']]);
  sheet.getRange('A1').setFontWeight('bold').setFontSize(12);

  // ---- Key-value defaults ----
  sheet.getRange('A2:B6').setValues([
    ['Default Symbol',   'VNM'],
    ['Default Period',   'year'],       // year | quarter
    ['Default Limit',    '5'],          // 1-20
    ['Default Interval', '1D'],         // 1D | 1W | 1M
    ['Default Exchange', 'HOSE'],       // HOSE | HNX | UPCOM | ALL
  ]);
  sheet.getRange('A2:A6').setFontWeight('bold');

  // ---- Notes ----
  sheet.getRange('A7').setValue('');
  sheet.getRange('A8').setValue('Period options: year, quarter');
  sheet.getRange('A9').setValue('Interval options: 1D, 1W, 1M');

  // ---- Watchlist header ----
  sheet.getRange('A' + SETTINGS_LAYOUT.WATCHLIST_START_ROW)
    .setValue('Watchlist (one ticker per row, column A)')
    .setFontWeight('bold');

  // Default watchlist
  var defaultWatchlist = [['VNM'],['FPT'],['TCB'],['HPG'],['MWG']];
  sheet.getRange(SETTINGS_LAYOUT.WATCHLIST_START_ROW + 1, 1, defaultWatchlist.length, 1)
    .setValues(defaultWatchlist);

  sheet.autoResizeColumn(1);
  sheet.setColumnWidth(2, 160);

  Logger.log('Created Settings sheet "' + SETTINGS_SHEET_NAME + '".');
  return sheet;
}

/**
 * Read user-editable defaults from the Settings sheet.
 * Falls back to CONFIG / hardcoded defaults when the sheet doesn't exist.
 * @returns {{defaultSymbol, defaultPeriod, defaultLimit, defaultInterval, defaultExchange, watchlist}}
 */
function readSettings_() {
  var defaults = {
    defaultSymbol:   'VNM',
    defaultPeriod:   'year',
    defaultLimit:    5,
    defaultInterval: '1D',
    defaultExchange: 'HOSE',
    watchlist:       CONFIG.watchlist || ['VNM'],
  };

  var ss;
  try { ss = resolveSpreadsheet_(); } catch (e) { return defaults; }

  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) return defaults;

  var L = SETTINGS_LAYOUT;
  function cell(row) {
    var v = sheet.getRange(row, 2).getValue();
    return (v !== null && v !== undefined && v !== '') ? String(v).trim() : null;
  }

  defaults.defaultSymbol   = (cell(L.DEFAULT_SYMBOL_ROW)   || defaults.defaultSymbol).toUpperCase();
  defaults.defaultPeriod   =  cell(L.DEFAULT_PERIOD_ROW)   || defaults.defaultPeriod;
  defaults.defaultLimit    = parseInt(cell(L.DEFAULT_LIMIT_ROW), 10) || defaults.defaultLimit;
  defaults.defaultInterval =  cell(L.DEFAULT_INTERVAL_ROW) || defaults.defaultInterval;
  defaults.defaultExchange = (cell(L.DEFAULT_EXCHANGE_ROW) || defaults.defaultExchange).toUpperCase();

  // Watchlist: every non-empty cell in column A from WATCHLIST_START_ROW+1 down.
  var lastRow = sheet.getLastRow();
  var watchlistStart = L.WATCHLIST_START_ROW + 1;
  if (lastRow >= watchlistStart) {
    var raw = sheet.getRange(watchlistStart, 1, lastRow - watchlistStart + 1, 1).getValues();
    var list = [];
    for (var i = 0; i < raw.length; i++) {
      var sym = String(raw[i][0] || '').trim().toUpperCase();
      if (sym) list.push(sym);
    }
    if (list.length) defaults.watchlist = list;
  }

  return defaults;
}


// ===========================================================================
// Core HTTP client — retry, structured errors, key resolution
// ===========================================================================

/**
 * Resolve the API key from Script Properties first, then CONFIG.
 * Storing the key in Script Properties keeps the secret out of source code.
 *
 * @returns {string} The API key, or '' if unset.
 */
function readApiKey_() {
  try {
    var prop = PropertiesService.getScriptProperties()
      .getProperty('VNIBB_APPS_SCRIPT_KEY');
    if (prop) return prop;
  } catch (e) { /* PropertiesService may be unavailable in some contexts */ }
  return CONFIG.apiKey || '';
}

/**
 * Validate CONFIG before any network call. Throws a descriptive Error that
 * tells the user exactly which field is wrong — prevents cryptic downstream
 * failures like a 404 on the base URL or an auth 401.
 */
function assertConfig_() {
  var key = readApiKey_();
  if (!CONFIG.baseUrl || CONFIG.baseUrl.indexOf('YOUR_HOST') !== -1) {
    throw new Error(
      'CONFIG.baseUrl is not set. Point it at your VNIBB host, e.g. ' +
      '"https://your-host.sslip.io/api/v1/apps-script" (no trailing slash).'
    );
  }
  if (CONFIG.baseUrl.charAt(CONFIG.baseUrl.length - 1) === '/') {
    throw new Error('CONFIG.baseUrl must NOT end with a trailing slash.');
  }
  if (CONFIG.baseUrl.indexOf('/api/v1/apps-script') === -1) {
    throw new Error('CONFIG.baseUrl must end in /api/v1/apps-script.');
  }
  if (!key) {
    throw new Error(
      'API key is not set. Put it in Script Properties (key: ' +
      'VNIBB_APPS_SCRIPT_KEY) or in CONFIG.apiKey. It must match the ' +
      'server VNIBB_APPS_SCRIPT_KEY value.'
    );
  }
}

/**
 * Perform a GET against the VNIBB Apps Script API with retry + backoff.
 *
 * Uses muteHttpExceptions so non-200 responses are inspected rather than
 * thrown by UrlFetchApp, giving precise error messages. Retries only on
 * transient failures (5xx and network exceptions), never on 4xx (which are
 * client errors: bad key, bad params, unknown symbol).
 *
 * @param {string} endpoint  Path after /apps-script, e.g. '/financials/VNM'.
 * @param {Object=} params   Query params as {key: value}. Nullish values skipped.
 * @returns {*}              Parsed JSON (array or object depending on endpoint).
 * @throws {Error}           On 4xx, exhausted retries, or JSON parse failure.
 */
function fetchVnibb(endpoint, params) {
  assertConfig_();

  var queryString = Object.keys(params || {})
    .filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');

  var url = CONFIG.baseUrl + endpoint + (queryString ? '?' + queryString : '');

  var options = {
    method: 'get',
    headers: { 'X-API-Key': readApiKey_(), 'Accept': 'application/json' },
    muteHttpExceptions: true,
    followRedirects: true,
  };

  var attempts = Math.max(1, CONFIG.timeoutRetries || 1);
  var lastErr = null;

  for (var i = 0; i < attempts; i++) {
    var response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (netErr) {
      // Network-level failure (DNS, TLS, timeout). Transient — retry.
      lastErr = new Error('Network error calling ' + url + ': ' + netErr.message);
      Utilities.sleep((CONFIG.retryBackoffMs || 1000) * (i + 1));
      continue;
    }

    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 200) {
      try {
        return JSON.parse(body);
      } catch (parseErr) {
        throw new Error('VNIBB returned 200 but body was not valid JSON: ' + body.slice(0, 300));
      }
    }

    // 4xx = client error. Do NOT retry — surface a clear, actionable message.
    if (code >= 400 && code < 500) {
      var hint = '';
      if (code === 401) hint = ' (API key rejected — check VNIBB_APPS_SCRIPT_KEY)';
      else if (code === 404) hint = ' (endpoint or symbol not found — check the path and ticker)';
      else if (code === 422) hint = ' (missing/invalid query params — e.g. historical needs start_date)';
      else if (code === 503) hint = ' (server has no VNIBB_APPS_SCRIPT_KEY configured)';
      throw new Error('VNIBB API ' + code + hint + ': ' + body.slice(0, 300));
    }

    // 5xx = server/transient error. Retry with backoff.
    lastErr = new Error('VNIBB API ' + code + ' (server error): ' + body.slice(0, 300));
    if (i < attempts - 1) Utilities.sleep((CONFIG.retryBackoffMs || 1000) * (i + 1));
  }

  throw lastErr || new Error('VNIBB request failed after ' + attempts + ' attempts: ' + url);
}


// ===========================================================================
// PRIMARY USE CASE — Financial Statements
// ===========================================================================

/**
 * Fetch one financial statement for a symbol and write it into its own tab.
 *
 * @param {string} symbol         Ticker, e.g. 'VNM'.
 * @param {string=} statementType 'income' | 'balance' | 'cashflow' (default 'income').
 * @param {string=} period        'year' | 'quarter' (default 'year').
 * @param {number=} limit         Periods to pull, 1-20 (default 5).
 * @returns {Array<Object>}       The rows written (also written to sheet).
 */
function pullFinancials(symbol, statementType, period, limit) {
  symbol        = (symbol || 'VNM').toUpperCase();
  statementType = statementType || 'income';
  period        = period || 'year';
  limit         = Number(limit) || 5;

  var data = fetchVnibb('/financials/' + encodeURIComponent(symbol), {
    statement_type: statementType,
    period: period,
    limit: limit,
  });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No ' + statementType + ' data for ' + symbol + ' (' + period + ').');
    return [];
  }

  var tab = symbol + ' ' + statementType + ' (' + period + ')';
  writeRowsToSheet(data, tab);
  Logger.log('Wrote ' + data.length + ' ' + statementType + ' periods for ' + symbol + '.');
  return data;
}

/**
 * Pull ALL THREE statements (income, balance, cashflow) for a symbol, each
 * into its own tab. This is the core "financial data first" convenience.
 *
 * @param {string} symbol   Ticker, e.g. 'VNM'.
 * @param {string=} period  'year' | 'quarter' (default 'year').
 * @param {number=} limit   Periods per statement, 1-20 (default 5).
 */
function pullAllFinancials(symbol, period, limit) {
  symbol = (symbol || 'VNM').toUpperCase();
  period = period || 'year';
  limit  = Number(limit) || 5;

  var types = ['income', 'balance', 'cashflow'];
  for (var i = 0; i < types.length; i++) {
    // Small pause between calls to stay well under rate/timeout limits.
    if (i > 0) Utilities.sleep(400);
    pullFinancials(symbol, types[i], period, limit);
  }
  Logger.log('Pulled all statements for ' + symbol + '.');
}

/**
 * Refresh a financial dashboard for the watchlist defined in the Settings
 * sheet (falls back to CONFIG.watchlist, then ['VNM']):
 *   - one "Ratios Summary" tab (one metrics row per ticker), and
 *   - per-ticker income statement tabs.
 * Period and limit come from the Settings sheet defaults.
 * Designed to be attached to an hourly/daily time-driven trigger.
 */
function refreshFinancialDashboard() {
  var s      = readSettings_();
  var list   = s.watchlist.length ? s.watchlist : ['VNM'];
  var period = s.defaultPeriod;
  var limit  = s.defaultLimit;

  // 1) Consolidated ratios: one row per ticker in a single tab.
  var summaryRows = [];
  for (var i = 0; i < list.length; i++) {
    if (i > 0) Utilities.sleep(300);
    try {
      var r = fetchVnibb('/ratios/' + encodeURIComponent(list[i].toUpperCase()), { period: period });
      if (Array.isArray(r) && r.length) summaryRows.push(r[0]);
    } catch (e) {
      Logger.log('Ratios failed for ' + list[i] + ': ' + e.message);
    }
  }
  if (summaryRows.length) writeRowsToSheet(summaryRows, 'Ratios Summary');

  // 2) Per-ticker income statement tabs.
  for (var j = 0; j < list.length; j++) {
    if (j > 0) Utilities.sleep(300);
    try {
      pullFinancials(list[j], 'income', period, limit);
    } catch (e) {
      Logger.log('Financials failed for ' + list[j] + ': ' + e.message);
    }
  }
  Logger.log('Dashboard refreshed for ' + list.length + ' tickers.');
}


// ===========================================================================
// Ratios (single flat row of ~84 metrics)
// ===========================================================================

/**
 * Fetch latest financial ratios for a symbol and write a one-row tab.
 *
 * @param {string} symbol   Ticker, e.g. 'VNM'.
 * @param {string=} period  'year' | 'quarter' (default 'year').
 * @returns {Object|null}   The ratio row, or null if none.
 */
function pullRatios(symbol, period) {
  symbol = (symbol || 'VNM').toUpperCase();
  period = period || 'year';
  var data = fetchVnibb('/ratios/' + encodeURIComponent(symbol), { period: period });
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No ratios for ' + symbol + '.');
    return null;
  }
  writeRowsToSheet(data, symbol + ' Ratios');
  Logger.log('Wrote ratios for ' + symbol + '.');
  return data[0];
}


// ===========================================================================
// Screener (84 metrics per ticker, whole exchange)
// ===========================================================================

/**
 * Fetch screener rows for an exchange and write them into a tab.
 *
 * @param {string=} exchange 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' (default 'HOSE').
 * @param {number=} limit    Max rows, 1-2000 (default 200).
 * @param {string=} industry Optional industry filter.
 * @param {string=} source   Data source (default 'KBS').
 */
function pullScreener(exchange, limit, industry, source) {
  exchange = exchange || 'HOSE';
  limit    = Number(limit) || 200;

  var data = fetchVnibb('/screener', {
    exchange: exchange,
    limit: limit,
    industry: industry || null,
    source: source || 'KBS',
  });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No screener rows for ' + exchange + '.');
    return [];
  }
  writeRowsToSheet(data, 'Screener (' + exchange + ')');
  Logger.log('Wrote ' + data.length + ' screener rows for ' + exchange + '.');
  return data;
}


// ===========================================================================
// Historical OHLCV  (NOTE: start_date is REQUIRED by the server)
// ===========================================================================

/**
 * Fetch OHLCV price history and write it into a tab.
 *
 * @param {string} symbol      Ticker, e.g. 'VNM'.
 * @param {string=} startDate  'YYYY-MM-DD'. Defaults to 1 year ago.
 * @param {string=} endDate    'YYYY-MM-DD'. Defaults to today.
 * @param {string=} interval   '1D' | '1W' | '1M' (default '1D').
 */
function pullHistorical(symbol, startDate, endDate, interval) {
  symbol   = (symbol || 'VNM').toUpperCase();
  interval = interval || '1D';
  var tz = Session.getScriptTimeZone();
  endDate = endDate || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (!startDate) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    startDate = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }

  var data = fetchVnibb('/historical/' + encodeURIComponent(symbol), {
    start_date: startDate,   // REQUIRED — server returns 422 without it
    end_date: endDate,
    interval: interval,
  });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No historical data for ' + symbol + '.');
    return [];
  }
  writeRowsToSheet(data, symbol + ' OHLCV');
  Logger.log('Wrote ' + data.length + ' candles for ' + symbol + '.');
  return data;
}


// ===========================================================================
// Live Quote (StandardResponse wrapper — data is under .data)
// ===========================================================================

/**
 * Fetch a live quote for one ticker. Logs it; returns the quote object.
 *
 * @param {string} symbol   Ticker, e.g. 'VNM'.
 * @param {string=} source  Quote source (default 'VCI').
 * @returns {Object}        The quote object (result.data).
 */
function pullQuote(symbol, source) {
  symbol = (symbol || 'VNM').toUpperCase();
  source = source || 'VCI';
  var result = fetchVnibb('/quote/' + encodeURIComponent(symbol), { source: source });
  var q = (result && result.data) ? result.data : result;
  Logger.log(symbol + ' quote: ' + JSON.stringify(q));
  return q;
}


// ===========================================================================
// Listing (lightweight symbol list)
// ===========================================================================

/**
 * Fetch the symbol list for an exchange and write it into a tab.
 *
 * @param {string=} exchange 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' (default 'HOSE').
 */
function pullListing(exchange) {
  exchange = exchange || 'HOSE';
  var data = fetchVnibb('/listing', { exchange: exchange });
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No listing for ' + exchange + '.');
    return [];
  }
  writeRowsToSheet(data, 'Listing ' + exchange);
  Logger.log('Wrote ' + data.length + ' symbols for ' + exchange + '.');
  return data;
}


// ===========================================================================
// Market Indices
// ===========================================================================

/** Fetch VNINDEX / VN30 / HNX / UPCOM snapshots into a tab. */
function pullMarketIndices() {
  var data = fetchVnibb('/market/indices', {});
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No index data returned.');
    return [];
  }
  writeRowsToSheet(data, 'Market Indices');
  Logger.log('Wrote ' + data.length + ' indices.');
  return data;
}


// ===========================================================================
// Health Check
// ===========================================================================

/**
 * Ping the API. Also the fastest way to validate CONFIG (auth + connectivity).
 * @returns {Object} {status, database, version}
 */
function vnibbHealth() {
  var result = fetchVnibb('/health', {});
  Logger.log('VNIBB Health: ' + JSON.stringify(result));
  try {
    SpreadsheetApp.getUi().alert('VNIBB Health: ' + JSON.stringify(result));
  } catch (e) { /* no UI in standalone */ }
  return result;
}


// ===========================================================================
// Generic sheet writer — resolves target Sheet, handles nested values
// ===========================================================================

/**
 * Resolve the target Spreadsheet: the active one when bound, otherwise the
 * one named by CONFIG.spreadsheetId. Throws a clear error if neither works.
 * @returns {Spreadsheet}
 */
function resolveSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  if (!CONFIG.spreadsheetId) {
    throw new Error(
      'No active spreadsheet. This script is standalone — set ' +
      'CONFIG.spreadsheetId to the target Sheet ID (the long token in its ' +
      'URL), or create the script from inside a Sheet (Extensions > Apps Script).'
    );
  }
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

/**
 * Write an array of flat objects into a named tab. Headers are the union of
 * all keys across rows (so rows with differing shapes stay aligned). Nested
 * objects/arrays are JSON-stringified because Sheets' setValues rejects
 * non-primitive cell values.
 *
 * @param {Array<Object>} rows      Array of {key: value} objects.
 * @param {string} sheetName        Target tab name.
 */
function assertSheetCellBudget_(rows, columns) {
  var cells = rows * columns;
  var limit = Number(CONFIG.maxSheetCells) || 10000000;
  if (cells > limit) throw new Error('Sheet cell budget exceeded: ' + cells + ' cells exceeds ' + limit + '. Narrow the request or raise CONFIG.maxSheetCells within the Google Sheets limit.');
}

function writeRowsToSheet(rows, sheetName) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  var headers = [];
  var seen = {};
  for (var r = 0; r < rows.length; r++) {
    var keys = Object.keys(rows[r] || {});
    for (var k = 0; k < keys.length; k++) {
      if (!seen[keys[k]]) { seen[keys[k]] = true; headers.push(keys[k]); }
    }
  }
  var numCols = headers.length;
  if (numCols === 0) return;

  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row ? row[h] : undefined;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v); // nested -> text
      return v;
    });
  });
  assertSheetCellBudget_(values.length + 1, numCols);

  var ss   = resolveSpreadsheet_();
  var name = sheetName || 'VNIBB Data';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clear();
  }

  sheet.getRange(1, 1, 1, numCols).setValues([headers]);
  sheet.getRange(2, 1, values.length, numCols).setValues(values);
  sheet.setFrozenRows(1);

  Logger.log('Wrote ' + values.length + ' rows, ' + numCols + ' cols to "' + name + '".');
}


// ===========================================================================
// Demo — quick end-to-end smoke test from the editor
// ===========================================================================

/**
 * Run this first to verify CONFIG works. Creates the Settings sheet (if
 * missing) then pulls the default symbol's income statement using the
 * Settings-sheet defaults.
 */
function demo() {
  vnibbHealth();
  ensureSettingsSheet_();
  var s = readSettings_();
  pullFinancials(s.defaultSymbol, 'income', s.defaultPeriod, s.defaultLimit);
}


// ===========================================================================
// Custom spreadsheet functions — call directly from cells, any ticker
// ===========================================================================

/**
 * =VNIBB_QUOTE("VNM")  — live price for a ticker, straight into a cell.
 * @param {string} symbol  Ticker, e.g. "VNM".
 * @param {string=} field  Optional field to return (e.g. "price", "change_pct").
 *                         Omit to return the price.
 * @return {number|string} The requested value.
 * @customfunction
 */
function VNIBB_QUOTE(symbol, field) {
  if (!symbol) throw new Error('VNIBB_QUOTE needs a ticker, e.g. =VNIBB_QUOTE("VNM")');
  var q = pullQuote(String(symbol).trim().toUpperCase());
  if (!q) return '';
  var key = field ? String(field).trim() : 'price';
  var v = q[key];
  return (v === null || v === undefined) ? '' : v;
}

/**
 * =VNIBB_RATIO("VNM","roe")  — one financial-ratio metric into a cell.
 * @param {string} symbol  Ticker, e.g. "VNM".
 * @param {string} field   Ratio field name (e.g. "roe", "pe", "eps").
 * @param {string=} period "year" | "quarter" (default "year").
 * @return {number|string} The metric value, or '' if unavailable.
 * @customfunction
 */
function VNIBB_RATIO(symbol, field, period) {
  if (!symbol) throw new Error('VNIBB_RATIO needs a ticker, e.g. =VNIBB_RATIO("VNM","roe")');
  if (!field)  throw new Error('VNIBB_RATIO needs a field, e.g. =VNIBB_RATIO("VNM","roe")');
  var data = fetchVnibb('/ratios/' + encodeURIComponent(String(symbol).trim().toUpperCase()), {
    period: period ? String(period).trim() : 'year',
  });
  if (!Array.isArray(data) || data.length === 0) return '';
  var v = data[0][String(field).trim()];
  return (v === null || v === undefined) ? '' : v;
}

/**
 * =VNIBB_FINANCIAL("VNM","revenue")  — one line item from a financial statement.
 * Financials are the primary use case, so this is the workhorse cell formula.
 *
 * @param {string} symbol         Ticker, e.g. "VNM".
 * @param {string} field          Line-item field name (e.g. "revenue", "net_profit").
 * @param {string=} statementType "income" | "balance" | "cashflow" (default "income").
 * @param {string=} period        "year" | "quarter" (default "year").
 * @param {number=} periodsAgo    0 = latest period, 1 = previous, ... (default 0).
 * @return {number|string}        The value, or '' if unavailable.
 * @customfunction
 */
function VNIBB_FINANCIAL(symbol, field, statementType, period, periodsAgo) {
  if (!symbol) throw new Error('VNIBB_FINANCIAL needs a ticker, e.g. =VNIBB_FINANCIAL("VNM","revenue")');
  if (!field)  throw new Error('VNIBB_FINANCIAL needs a field, e.g. =VNIBB_FINANCIAL("VNM","revenue")');
  var idx = Math.max(0, Number(periodsAgo) || 0);
  var data = fetchVnibb('/financials/' + encodeURIComponent(String(symbol).trim().toUpperCase()), {
    statement_type: statementType ? String(statementType).trim() : 'income',
    period: period ? String(period).trim() : 'year',
    limit: idx + 1,
  });
  if (!Array.isArray(data) || data.length === 0) return '';
  var row = data[idx] || data[data.length - 1];
  var v = row ? row[String(field).trim()] : undefined;
  return (v === null || v === undefined) ? '' : v;
}
