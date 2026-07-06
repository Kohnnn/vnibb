/**
 * VNIBB Google Apps Script Client
 * ================================
 * Bound to a Google Sheet; fetches live Vietnamese stock data from VNIBB's
 * FastAPI via Tailscale Funnel and writes results into the active sheet.
 *
 * SETUP
 * -----
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste the contents of this file into Code.gs
 * 3. Fill in CONFIG below with your Tailscale Funnel URL and API key
 * 4. Save (Cmd+S / Ctrl+S), then run `pullScreener()` from the function picker
 *
 * SCHEDULE
 * --------
 * Add a trigger: Edit → Triggers → Add Trigger → pullScreener → Time-driven → Hourly
 *
 * N6V DEPLOYMENT
 * ---------------
 * On the n6v machine, open an elevated PowerShell and run:
 *   sudo tailscale funnel 8000
 * This publishes FastAPI on https://<n6v-host>.tailnet.ts.net with automatic TLS.
 * Set the resulting URL (without /api/v1/apps-script) as CONFIG.baseUrl below.
 */

const CONFIG = {
  /** e.g. 'https://n6v.tailnet.ts.net' — no trailing slash */
  baseUrl: 'https://YOUR_HOST.your-tailnet.ts.net/api/v1/apps-script',

  /** Generated secret matching VNIBB_APPS_SCRIPT_KEY env var on the server */
  apiKey: 'YOUR_SECRET_KEY_HERE',
};


// ===========================================================================
// Core HTTP client
// ===========================================================================

/**
 * Generic GET request to the VNIBB Apps Script API.
 *
 * @param {string} endpoint  Path portion after /api/v1/apps-script, e.g. '/screener'
 * @param {Object} params    URL query params as {key: value}
 * @returns {Object}        Parsed JSON response
 * @throws {Error}         On non-200 status or network failure
 */
function fetchVnibb(endpoint, params) {
  var queryString = Object.keys(params || {})
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');

  var url = CONFIG.baseUrl + endpoint + (queryString ? '?' + queryString : '');

  var response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': CONFIG.apiKey,
      'Accept': 'application/json',
    },
    muteHttpExceptions: false,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    throw new Error('VNIBB API error ' + code + ': ' + body);
  }

  return JSON.parse(body);
}


// ===========================================================================
// Pull: Stock Screener (84 metrics per ticker)
// ===========================================================================

/**
 * Fetch HOSE screener rows and write them into the active sheet.
 * Column headers are auto-derived from the first row's keys.
 *
 * @param {string} exchange  'HOSE' | 'HNX' | 'UPCOM' | 'ALL' (default: HOSE)
 * @param {number} limit     Max rows to pull (default: 200, max: 2000)
 */
function pullScreener(exchange, limit) {
  exchange = exchange || 'HOSE';
  limit    = limit    || 200;

  var data = fetchVnibb('/screener', { exchange: exchange, limit: limit });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No screener rows returned. Check API key and network.');
    return;
  }

  writeRowsToSheet(data, 'Screener (' + exchange + ')');
  Logger.log('Wrote ' + data.length + ' rows to Screener sheet.');
}


// ===========================================================================
// Pull: Financial Statements
// ===========================================================================

/**
 * Fetch financial statements for a symbol and write them into the active sheet.
 *
 * @param {string} symbol         Ticker, e.g. 'VNM'
 * @param {string} statementType  'income' | 'balance' | 'cashflow' (default: income)
 * @param {string} period         'year' | 'quarter' (default: year)
 * @param {number} limit          Number of periods (default: 5)
 */
function pullFinancials(symbol, statementType, period, limit) {
  symbol        = (symbol        || 'VNM').toUpperCase();
  statementType = statementType   || 'income';
  period        = period         || 'year';
  limit         = Number(limit)  || 5;

  var data = fetchVnibb('/financials/' + symbol, {
    statement_type: statementType,
    period: period,
    limit: limit,
  });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No financial data returned for ' + symbol);
    return;
  }

  writeRowsToSheet(data, symbol + ' ' + statementType + ' (' + period + ')');
  Logger.log('Wrote ' + data.length + ' periods for ' + symbol + '.');
}


// ===========================================================================
// Pull: Historical OHLCV
// ===========================================================================

/**
 * Fetch OHLCV price history for a symbol.
 *
 * @param {string} symbol    Ticker, e.g. 'VNM'
 * @param {string} startDate  ISO date YYYY-MM-DD (default: 1 year ago)
 * @param {string} endDate    ISO date YYYY-MM-DD (default: today)
 * @param {string} interval   '1D' | '1W' | '1M' (default: 1D)
 */
function pullHistorical(symbol, startDate, endDate, interval) {
  symbol    = (symbol    || 'VNM').toUpperCase();
  interval  = interval  || '1D';
  endDate   = endDate   || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  if (!startDate) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    startDate = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var data = fetchVnibb('/historical/' + symbol, {
    start_date: startDate,
    end_date:   endDate,
    interval:   interval,
  });

  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No historical data for ' + symbol);
    return;
  }

  writeRowsToSheet(data, symbol + ' OHLCV');
  Logger.log('Wrote ' + data.length + ' candles for ' + symbol + '.');
}


// ===========================================================================
// Pull: Live Quote
// ===========================================================================

/**
 * Fetch a live quote for a symbol and print it to the log.
 * Use writeRowsToSheet([data.data], 'Quote') to write to a sheet.
 *
 * @param {string} symbol  Ticker, e.g. 'VNM'
 * @param {string} source  Quote source (default: VCI)
 * @returns {Object}       The quote object
 */
function pullQuote(symbol, source) {
  symbol = (symbol || 'VNM').toUpperCase();
  source = source || 'VCI';

  var result = fetchVnibb('/quote/' + symbol, { source: source });

  // Result wraps in StandardResponse: {data: {symbol, price, change, ...}}
  if (result && result.data) {
    var q = result.data;
    Logger.log(
      symbol + ' quote: price=' + q.price +
      ' change=' + q.change + ' (' + q.change_pct + '%)' +
      ' vol=' + q.volume
    );
    return q;
  }

  Logger.log('Quote result: ' + JSON.stringify(result));
  return result;
}


// ===========================================================================
// Pull: Financial Ratios
// ===========================================================================

/**
 * Fetch latest financial ratios for a symbol.
 *
 * @param {string} symbol  Ticker, e.g. 'VNM'
 * @returns {Object}       Ratio dict
 */
function pullRatios(symbol) {
  symbol = (symbol || 'VNM').toUpperCase();
  var data = fetchVnibb('/ratios/' + symbol);
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No ratios for ' + symbol);
    return null;
  }
  writeRowsToSheet(data, symbol + ' Ratios');
  Logger.log('Wrote ratios for ' + symbol + '.');
  return data[0];
}


// ===========================================================================
// Pull: Market Indices
// ===========================================================================

/**
 * Fetch VNINDEX, VN30, HNX, UPCOM index snapshots.
 */
function pullMarketIndices() {
  var data = fetchVnibb('/market/indices');
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No index data returned.');
    return;
  }
  writeRowsToSheet(data, 'Market Indices');
  Logger.log('Wrote ' + data.length + ' indices.');
}


// ===========================================================================
// Pull: Symbol Listing
// ===========================================================================

/**
 * Fetch lightweight symbol list (symbol, company_name, exchange, industry).
 *
 * @param {string} exchange  'HOSE' | 'HNX' | 'UPCOM' | 'ALL' (default: HOSE)
 */
function pullListing(exchange) {
  exchange = exchange || 'HOSE';
  var data = fetchVnibb('/listing', { exchange: exchange });
  if (!Array.isArray(data) || data.length === 0) {
    Logger.log('No listing for ' + exchange);
    return;
  }
  writeRowsToSheet(data, 'Listing ' + exchange);
  Logger.log('Wrote ' + data.length + ' symbols.');
}


// ===========================================================================
// Health Check
// ===========================================================================

/**
 * Ping the Apps Script endpoint to confirm the service is up.
 *
 * @returns {Object}  {status, database, version}
 */
function vnibbHealth() {
  var result = fetchVnibb('/health', {});
  Logger.log('VNIBB Health: ' + JSON.stringify(result));
  return result;
}


// ===========================================================================
// Demo — pull VNM income statement
// ===========================================================================

function demo() {
  pullFinancials('VNM', 'income', 'year', 5);
}


// ===========================================================================
// Generic sheet writer
// ===========================================================================

/**
 * Write an array of flat objects (rows) into a new or existing sheet tab.
 * The first row is used as column headers.
 *
 * @param {Array<Object>} rows   Array of {key: value} objects
 * @param {string}        sheetName  Name of the sheet tab
 */
function writeRowsToSheet(rows, sheetName) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var name  = sheetName || 'VNIBB Data';
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clearContents();
  }

  var headers = Object.keys(rows[0]);
  var numRows = rows.length;
  var numCols = headers.length;

  // Write header row
  sheet.getRange(1, 1, 1, numCols).setValues([headers]);

  // Write data rows
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      // Flatten null / undefined to empty string
      return (v === null || v === undefined) ? '' : v;
    });
  });
  sheet.getRange(2, 1, numRows, numCols).setValues(values);

  // Freeze header row
  sheet.setFrozenRows(1);

  Logger.log('Wrote ' + numRows + ' rows, ' + numCols + ' cols to "' + name + '".');
}
