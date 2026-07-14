/**
 * ============================================================================
 * VNIBB BigQuery Apps Script Client — Vietnamese Stock Data straight from BQ
 * ============================================================================
 *
 * WHAT THIS IS
 * ------------
 * A Google Apps Script that runs read-only BigQuery Standard SQL and writes
 * results into Google Sheets tabs. It uses the built-in BigQuery advanced
 * service and the running user's OAuth identity; it does not use a backend API
 * key. The configured warehouse is externally managed. Verify its schema,
 * metadata, data types, ownership, and access before use.
 *
 * WHEN TO USE WHICH CLIENT
 * ------------------------
 *   apps_script_client.gs  -> bounded live API pulls using an API key.
 *   THIS FILE              -> bounded read-only warehouse queries using OAuth.
 *
 * DATA SOURCE
 * -----------
 * CONFIG selects the billing project, dataset project, dataset, and location.
 * The defaults are examples, not verified live warehouse metadata.
 *
 * PREREQUISITES  (one-time)
 * -------------------------
 *   1. Enable the BigQuery advanced service in this Apps Script project:
 *        Editor -> Services (+) -> "BigQuery API" -> Add.
 *      (Under the hood this adds the `BigQuery` global used below.)
 *   2. Configure a billed job project and least-privilege read access to the
 *      externally managed dataset.
 *   3. On first run, approve the OAuth consent screen (BigQuery + Sheets).
 *
 * A NOTE ON CELL FORMULAS
 * -----------------------
 * Google FORBIDS custom spreadsheet functions (=FOO() typed in a cell) from
 * calling services that require authorization, and BigQuery requires
 * authorization. So there are intentionally NO =BQ_*() cell functions here —
 * they would throw a permission error. For live cell-level BigQuery access use
 * Google's built-in **Connected Sheets** (Data -> Data connectors ->
 * Connect to BigQuery), which is the supported path. This script covers the
 * programmatic / scheduled / bulk-export side.
 *
 * SECURITY
 * --------
 * BigQuery auth is OAuth via the running user's Google account — there is NO
 * API key or secret in this file, so it is safe to commit to a public repo.
 * CONFIG.projectId is a GCP project id (not a secret).
 *
 * SCHEDULING
 * ----------
 * Triggers -> Add Trigger -> pick a pull or refresh function -> Time-driven.
 * ============================================================================
 */

// ===========================================================================
// CONFIG
// ===========================================================================

var CONFIG = {
  /**
   * GCP project that RUNS (and bills for) the query jobs. Must have billing
   * enabled and the BigQuery Job User role. During the trial this is the same
   * project that holds the data.
   */
  projectId: 'vnibb-data',

  /** Project that OWNS the dataset (where the tables physically live). */
  datasetProject: 'vnibb-data',

  /** Dataset name. */
  datasetId: 'vnibb',

  /**
   * BigQuery processing location. MUST match the dataset's region or jobs 404.
   * The vnibb dataset is in asia-southeast1 (immutable).
   */
  location: 'asia-southeast1',

  /** Hard cap on rows pulled into a sheet (protects against runaway scans). */
  maxRows: 50000,

  maxSheetCells: 10000000,
  maxBytesBilled: '10737418240',

  /** Default watchlist for refreshDashboard(). */
  watchlist: ['VNM', 'FPT', 'TCB', 'HPG', 'MWG'],

  /** Poll settings while a query job completes. */
  jobPollTries: 30,
  jobPollMs: 1000,

  /**
   * Gemini model for the natural-language -> SQL bridge (askGemini).
   * The API key is NEVER stored here — it lives in Script Properties under
   * the key GEMINI_API_KEY in Project Settings -> Script Properties.
   */
  geminiModel: 'gemini-flash-latest',
};


// ===========================================================================
// Spreadsheet UI menu (bound mode)
// ===========================================================================

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('VNIBB (BigQuery)')
      .addItem('📊 Refresh Dashboard (watchlist)', 'refreshDashboard')
      .addSeparator()
      .addSubMenu(SpreadsheetApp.getUi().createMenu('Pull for symbol…')
        .addItem('Income Statement', 'menuPullIncome_')
        .addItem('Balance Sheet', 'menuPullBalance_')
        .addItem('Cash Flow Statement', 'menuPullCashflow_')
        .addItem('Financial Ratios', 'menuPullRatios_')
        .addItem('Daily Prices (stock_prices)', 'menuPullPrices_')
        .addItem('EOD Prices (mongo, adjusted)', 'menuPullMongoPrices_')
        .addItem('Company Profile', 'menuPullCompany_'))
      .addSubMenu(SpreadsheetApp.getUi().createMenu('Market data…')
        .addItem('Screener snapshot (latest)', 'menuPullScreener_')
        .addItem('Listing (all symbols)', 'pullListing')
        .addItem('Market Indices (latest)', 'pullMarketIndices'))
      .addSeparator()
      .addItem('✨ Ask in plain English (Gemini → SQL)', 'menuAskGemini_')
      .addItem('✨ Run English from ⚙ SQL sheet (cell B1)', 'askGeminiFromSheet')
      .addSeparator()
      .addItem('▶ Run Custom SQL (from ⚙ SQL sheet)', 'runCustomSqlFromSheet')
      .addItem('🩺 List Tables + Row Counts', 'listTables')
      .addToUi();
  } catch (e) {
    // getUi() throws in standalone context — safe to ignore.
  }
}

function menuPromptSymbol_(title, def) {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(title, 'Ticker (e.g. ' + (def || 'VNM') + '):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  return (resp.getResponseText() || def || '').trim().toUpperCase() || null;
}

function menuPullIncome_()   { var s = menuPromptSymbol_('Income Statement');  if (s) pullFinancials(s, 'income'); }
function menuPullBalance_()  { var s = menuPromptSymbol_('Balance Sheet');     if (s) pullFinancials(s, 'balance'); }
function menuPullCashflow_() { var s = menuPromptSymbol_('Cash Flow');         if (s) pullFinancials(s, 'cashflow'); }
function menuPullRatios_()   { var s = menuPromptSymbol_('Financial Ratios');  if (s) pullRatios(s); }
function menuPullPrices_()   { var s = menuPromptSymbol_('Daily Prices');      if (s) pullPrices(s, 365); }
function menuPullMongoPrices_(){ var s = menuPromptSymbol_('EOD Prices');      if (s) pullMongoEodPrices(s, 365); }
function menuPullCompany_()  { var s = menuPromptSymbol_('Company Profile');   if (s) pullCompany(s); }

function menuPullScreener_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Screener', 'Exchange (HOSE / HNX / UPCOM / ALL):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var exch = (resp.getResponseText() || 'ALL').trim().toUpperCase() || 'ALL';
  pullScreener(exch, 500);
}


// ===========================================================================
// Core BigQuery client — run SQL, page results, return {headers, rows}
// ===========================================================================

/**
 * Fully-qualified `project.dataset.table` for a table name, backtick-safe.
 * @param {string} table  Bare table name, e.g. 'stock_prices'.
 * @returns {string}      "`vnibb-data`.`vnibb`.`stock_prices`"
 */
function fq_(table) {
  return '`' + CONFIG.datasetProject + '`.`' + CONFIG.datasetId + '`.`' + table + '`';
}

/**
 * Run a Standard SQL query against BigQuery and return all rows.
 * Handles async jobs (poll until done) and pagination of the result set.
 *
 * @param {string} sql               Standard SQL. Reference tables via fq_().
 * @param {number=} maxRows          Row cap (default CONFIG.maxRows).
 * @returns {{headers: string[], rows: Array<Array<string>>}}
 * @throws {Error} on BigQuery errors or if the advanced service is missing.
 */
function bqQuery_(sql, maxRows) {
  if (typeof BigQuery === 'undefined') {
    throw new Error(
      'BigQuery advanced service is not enabled. In the Apps Script editor: ' +
      'Services (+) -> add "BigQuery API", then re-run.'
    );
  }
  maxRows = maxRows || CONFIG.maxRows;
  sql = validateReadOnlySql_(sql);

  var request = {
    query: sql,
    useLegacySql: false,
    location: CONFIG.location,
    maximumBytesBilled: String(CONFIG.maxBytesBilled),
    // Ask for the first page inline; large result sets page via getQueryResults.
    maxResults: 10000,
    timeoutMs: 60000,
  };

  var queryResults = BigQuery.Jobs.query(request, CONFIG.projectId);
  var jobId = queryResults.jobReference && queryResults.jobReference.jobId;

  // Poll until the job reports completion (large scans return jobComplete=false).
  var tries = 0;
  while (!queryResults.jobComplete && tries < CONFIG.jobPollTries) {
    Utilities.sleep(CONFIG.jobPollMs);
    queryResults = BigQuery.Jobs.getQueryResults(CONFIG.projectId, jobId, {
      location: CONFIG.location,
      timeoutMs: 60000,
    });
    tries++;
  }
  if (!queryResults.jobComplete) {
    throw new Error('BigQuery job did not complete within the poll window (jobId ' + jobId + ').');
  }

  var headers = [];
  var fields = (queryResults.schema && queryResults.schema.fields) || [];
  for (var i = 0; i < fields.length; i++) headers.push(fields[i].name);

  var rows = [];
  var page = queryResults;
  while (true) {
    var pageRows = page.rows || [];
    for (var r = 0; r < pageRows.length; r++) {
      if (rows.length >= maxRows) break;
      var cells = pageRows[r].f || [];
      var out = [];
      for (var c = 0; c < cells.length; c++) {
        var v = cells[c] ? cells[c].v : null;
        out.push(v === null || v === undefined ? '' : v);
      }
      rows.push(out);
    }
    if (rows.length >= maxRows || !page.pageToken) break;
    page = BigQuery.Jobs.getQueryResults(CONFIG.projectId, jobId, {
      location: CONFIG.location,
      pageToken: page.pageToken,
      timeoutMs: 60000,
    });
  }

  Logger.log('BigQuery: ' + rows.length + ' rows, ' + headers.length + ' cols.');
  return { headers: headers, rows: rows };
}

/**
 * Run SQL and write the result into a named tab. Public entry point for the
 * generic path.
 * @param {string} sql        Standard SQL.
 * @param {string} sheetName  Target tab name.
 * @returns {number}          Rows written.
 */
function runSql(sql, sheetName) {
  var res = bqQuery_(sql);
  writeResultToSheet_(res, sheetName || 'BQ Result');
  return res.rows.length;
}

/**
 * Read SQL from cell A1 of a "⚙ SQL" sheet and run it into "BQ Result".
 * Lets non-coders paste ad-hoc queries. Creates the SQL sheet if missing.
 */
function runCustomSqlFromSheet() {
  var ss = resolveSpreadsheet_();
  var name = '⚙ SQL';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, 0);
    sheet.getRange('A1').setValue(
      'SELECT symbol, time, close, volume FROM ' + fq_('stock_prices') +
      " WHERE symbol='VNM' ORDER BY time DESC LIMIT 100"
    );
    sheet.getRange('A2').setValue('↑ Put your Standard SQL in A1, then VNIBB (BigQuery) -> Run Custom SQL.');
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
    return;
  }
  var sql = String(sheet.getRange('A1').getValue() || '').trim();
  if (!sql) throw new Error('Put a SQL query in cell A1 of the "' + name + '" sheet.');
  var n = runSql(sql, 'BQ Result');
  try { SpreadsheetApp.getUi().alert('Wrote ' + n + ' rows to "BQ Result".'); } catch (e) {}
}


// ===========================================================================
// Gemini NL -> SQL bridge (ask in plain English, get data)
// ===========================================================================

/**
 * The schema contract handed to Gemini so it writes correct BigQuery SQL for
 * THIS warehouse. Mirrors docs/BQ_CONNECTED_SHEETS_QUERIES.md §4.
 * @const {string}
 */
var GEMINI_SCHEMA_PROMPT =
  'Output exactly one BigQuery Standard SQL SELECT or WITH query and nothing else. ' +
  'Do not use comments, semicolons, scripts, DDL, DML, CALL, EXPORT, or multiple statements. ' +
  'Use only table and column names verified by the warehouse administrator. ' +
  'The configured dataset is externally managed; do not infer table counts, schema, or types. ' +
  'Use fully qualified tables for project ' + CONFIG.datasetProject + ', dataset ' + CONFIG.datasetId +
  ', location ' + CONFIG.location + '. Add a LIMIT unless the request requires a bounded aggregation.';

/**
 * Call the Gemini API to translate a plain-English request into BigQuery SQL.
 * Requires a Gemini API key stored in Script Properties under GEMINI_API_KEY
 * (File -> Project Settings -> Script Properties). Never hardcode the key.
 *
 * @param {string} question  Natural-language data request.
 * @returns {string}         BigQuery Standard SQL (fences/semicolons stripped).
 * @throws {Error} if the key is missing or the API errors.
 */
function geminiToSql_(question) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY not set. In the Apps Script editor: Project Settings ' +
      '(gear icon) -> Script Properties -> add GEMINI_API_KEY = your AI Studio key.'
    );
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            CONFIG.geminiModel + ':generateContent';
  var payload = {
    contents: [{ parts: [{ text: GEMINI_SCHEMA_PROMPT + '\nNOW WRITE THE QUERY FOR:\n' + question }] }],
    generationConfig: { temperature: 0 },
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-goog-api-key': key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    throw new Error('Gemini API error ' + code + ': ' + body.slice(0, 500));
  }

  var json = JSON.parse(body);
  var text = '';
  try {
    var parts = json.candidates[0].content.parts;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text) text += parts[i].text;
    }
  } catch (e) {
    throw new Error('Gemini returned no SQL. Raw: ' + body.slice(0, 500));
  }
  return validateReadOnlySql_(stripSqlFences_(text));
}

/**
 * Strip markdown code fences, a leading "sql" tag, and a trailing semicolon
 * so the model output is a clean runnable statement.
 * @param {string} s
 * @returns {string}
 */
function stripSqlFences_(s) {
  var out = String(s || '').trim();
  return out.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/**
 * The on-demand entry point: ask in plain English, Gemini writes the SQL,
 * BigQuery runs it, results land in a tab. Shows the generated SQL first so
 * you can confirm before it runs.
 */
function askGemini() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    'Ask VNIBB (Gemini -> BigQuery)',
    'Describe the data you want, e.g. "VCI revenue and net income last 5 years":',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var question = (resp.getResponseText() || '').trim();
  if (!question) return;

  var sql;
  try {
    sql = geminiToSql_(question);
  } catch (e) {
    ui.alert('Gemini error', String(e.message || e), ui.ButtonSet.OK);
    return;
  }

  // Show the SQL and let the user confirm before spending a BigQuery job.
  var confirm = ui.alert('Generated SQL', sql + '\n\nRun this against BigQuery?', ui.ButtonSet.OK_CANCEL);
  if (confirm !== ui.Button.OK) {
    // Still park the SQL in the ⚙ SQL sheet so it is editable/re-runnable.
    var ss = resolveSpreadsheet_();
    var s = ss.getSheetByName('⚙ SQL') || ss.insertSheet('⚙ SQL', 0);
    s.getRange('A1').setValue(sql);
    return;
  }

  var n;
  try {
    n = runSql(sql, 'Gemini Result');
  } catch (e) {
    // BigQuery rejected the model's SQL — park it so the user can fix + re-run.
    var ss2 = resolveSpreadsheet_();
    var s2 = ss2.getSheetByName('⚙ SQL') || ss2.insertSheet('⚙ SQL', 0);
    s2.getRange('A1').setValue(sql);
    ui.alert('BigQuery rejected the SQL',
      String(e.message || e) + '\n\nThe SQL was placed in the "⚙ SQL" sheet — edit A1 and use Run Custom SQL.',
      ui.ButtonSet.OK);
    return;
  }
  try { ui.alert('Done', 'Wrote ' + n + ' rows to "Gemini Result".', ui.ButtonSet.OK); } catch (e) {}
}

/** Menu handler: alias for askGemini() (prompt-driven NL -> SQL -> data). */
function menuAskGemini_() { askGemini(); }

/**
 * Non-interactive NL -> SQL: reads a plain-English request from cell B1 of the
 * "⚙ SQL" sheet, has Gemini write the SQL into A1, runs it into "Gemini Result".
 * Handy for a repeatable question you keep in the sheet (no dialog boxes).
 */
function askGeminiFromSheet() {
  var ss = resolveSpreadsheet_();
  var name = '⚙ SQL';
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name, 0);
  var question = String(sheet.getRange('B1').getValue() || '').trim();
  if (!question) {
    sheet.getRange('B1').setValue('VCI revenue and net income last 5 years');
    sheet.getRange('B2').setValue('↑ Put your plain-English request in B1, then VNIBB (BigQuery) -> Run English from ⚙ SQL sheet.');
    throw new Error('Put a plain-English request in cell B1 of the "' + name + '" sheet.');
  }
  var sql = geminiToSql_(question);
  sheet.getRange('A1').setValue(sql);      // show generated SQL (editable/re-runnable)
  var n = runSql(sql, 'Gemini Result');
  try { SpreadsheetApp.getUi().alert('Gemini wrote ' + n + ' rows to "Gemini Result". SQL is in ⚙ SQL!A1.'); } catch (e) {}
  return n;
}

// ===========================================================================
// Convenience pulls — Financial Statements (native typed tables)
// ===========================================================================

var FINANCIAL_TABLE = {
  income:   'income_statements',
  balance:  'balance_sheets',
  cashflow: 'cash_flows',
};

/**
 * Pull one financial statement for a symbol from its native typed table.
 * Selects a curated set of common line items (extend the SELECT as needed).
 *
 * @param {string} symbol         Ticker, e.g. 'VNM'.
 * @param {string=} statementType 'income' | 'balance' | 'cashflow' (default 'income').
 * @param {number=} limit         Periods, newest first (default 8).
 * @param {string=} period        'year' | 'quarter' (default 'year').
 * @returns {number}              Rows written.
 */
function pullFinancials(symbol, statementType, limit, period) {
  symbol        = (symbol || 'VNM').toUpperCase();
  statementType = statementType || 'income';
  limit         = Number(limit) || 8;
  period        = (period || 'year').toLowerCase();

  var table = FINANCIAL_TABLE[statementType];
  if (!table) throw new Error('statementType must be income | balance | cashflow.');

  // Native columns (no JSON_VALUE / SAFE_CAST needed).
  var fieldsByType = {
    income:   ['revenue', 'cost_of_revenue', 'gross_profit', 'operating_income',
               'income_before_tax', 'income_tax', 'net_income', 'ebitda',
               'eps', 'eps_diluted'],
    balance:  ['total_assets', 'current_assets', 'non_current_assets', 'fixed_assets',
               'cash_and_equivalents', 'inventory', 'total_liabilities',
               'current_liabilities', 'long_term_debt', 'short_term_debt',
               'total_equity', 'retained_earnings', 'book_value_per_share'],
    cashflow: ['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow',
               'capital_expenditure', 'free_cash_flow', 'depreciation',
               'dividends_paid', 'debt_repayment', 'net_change_in_cash'],
  };
  var metrics = fieldsByType[statementType];

  var cols = ['symbol', 'fiscal_year', 'fiscal_quarter', 'period_type'].concat(metrics);
  var selects = cols.map(function (c) { return '`' + c + '`'; });

  var sql =
    'SELECT ' + selects.join(', ') +
    ' FROM ' + fq_(table) +
    " WHERE UPPER(symbol) = '" + sqlLit_(symbol) + "'" +
    "   AND LOWER(IFNULL(period_type,'')) LIKE '" + sqlLit_(period) + "%'" +
    ' ORDER BY fiscal_year DESC, fiscal_quarter DESC' +
    ' LIMIT ' + limit;

  var res = bqQuery_(sql);
  writeResultToSheet_(res, symbol + ' ' + statementType + ' (BQ)');
  return res.rows.length;
}


// ===========================================================================
// Convenience pulls — Ratios (flat typed table)
// ===========================================================================

/**
 * Pull financial ratios for a symbol from the flat financial_ratios table.
 * @param {string} symbol  Ticker.
 * @param {number=} limit  Periods, newest first (default 8).
 * @returns {number}       Rows written.
 */
function pullRatios(symbol, limit) {
  symbol = (symbol || 'VNM').toUpperCase();
  limit  = Number(limit) || 8;
  var sql =
    'SELECT symbol, fiscal_year, fiscal_quarter, period_type, period,' +
    ' pe_ratio, pb_ratio, ps_ratio, ev_ebitda, ev_sales,' +
    ' roe, roa, roic, gross_margin, net_margin, operating_margin,' +
    ' eps, bvps, dps, current_ratio, quick_ratio, cash_ratio,' +
    ' debt_to_equity, interest_coverage, revenue_growth, earnings_growth' +
    ' FROM ' + fq_('financial_ratios') +
    " WHERE UPPER(symbol) = '" + sqlLit_(symbol) + "'" +
    ' ORDER BY fiscal_year DESC, fiscal_quarter DESC' +
    ' LIMIT ' + limit;
  var res = bqQuery_(sql);
  writeResultToSheet_(res, symbol + ' Ratios (BQ)');
  return res.rows.length;
}


// ===========================================================================
// Convenience pulls — Prices
// ===========================================================================

/**
 * Daily OHLCV from the flat stock_prices table (last N calendar days).
 * @param {string} symbol  Ticker.
 * @param {number=} days   Look-back window in days (default 365).
 * @returns {number}       Rows written.
 */
function pullPrices(symbol, days) {
  symbol = (symbol || 'VNM').toUpperCase();
  days   = Number(days) || 365;
  var sql =
    'SELECT symbol, time, open, high, low, close, volume, interval, source' +
    ' FROM ' + fq_('stock_prices') +
    " WHERE UPPER(symbol) = '" + sqlLit_(symbol) + "'" +
    '   AND time >= DATE_SUB(CURRENT_DATE(), INTERVAL ' + days + ' DAY)' +
    ' ORDER BY time DESC';
  var res = bqQuery_(sql);
  writeResultToSheet_(res, symbol + ' Prices (BQ)');
  return res.rows.length;
}

/**
 * EOD prices from market_prices_eod (partitioned by trade_date, clustered
 * by symbol — a single-symbol window scans almost nothing). This is the
 * vnstock-sourced series (often adjusted / more complete).
 * @param {string} symbol  Ticker.
 * @param {number=} days   Look-back window in days (default 365).
 * @returns {number}       Rows written.
 */
function pullMongoEodPrices(symbol, days) {
  symbol = (symbol || 'VNM').toUpperCase();
  days   = Number(days) || 365;
  var sql =
    'SELECT symbol, trade_date, open, high, low, close, volume, `interval`' +
    ' FROM ' + fq_('market_prices_eod') +
    " WHERE UPPER(symbol) = '" + sqlLit_(symbol) + "'" +
    '   AND trade_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ' + days + ' DAY)' +
    ' ORDER BY trade_date DESC';
  var res = bqQuery_(sql);
  writeResultToSheet_(res, symbol + ' EOD (BQ)');
  return res.rows.length;
}


// ===========================================================================
// Convenience pulls — Screener, Company, Listing, Indices
// ===========================================================================

/**
 * Latest screener snapshot per symbol from the screener_snapshots table.
 * Picks the most recent snapshot_date row for each ticker.
 * @param {string=} exchange 'HOSE' | 'HNX' | 'UPCOM' | 'ALL' (default 'ALL').
 * @param {number=} limit    Max rows (default 500).
 * @returns {number}         Rows written.
 */
function pullScreener(exchange, limit) {
  exchange = (exchange || 'ALL').toUpperCase();
  limit    = Number(limit) || 500;
  var exchFilter = (exchange === 'ALL')
    ? ''
    : " AND UPPER(exchange) = '" + sqlLit_(exchange) + "'";

  // Rank snapshots per symbol by date desc, keep the newest.
  var sql =
    'WITH base AS (' +
    '  SELECT symbol, company_name, exchange, industry, snapshot_date,' +
    '   price, market_cap, pe, pb, roe, roa, net_margin, debt_to_equity,' +
    '   dividend_yield, rs_rating' +
    '  FROM ' + fq_('screener_snapshots') +
    '  WHERE TRUE' + exchFilter +
    '), ranked AS (' +
    '  SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY snapshot_date DESC) AS rn' +
    '  FROM base' +
    ')' +
    ' SELECT * EXCEPT(rn) FROM ranked WHERE rn = 1' +
    ' ORDER BY market_cap DESC' +
    ' LIMIT ' + limit;

  var res = bqQuery_(sql);
  writeResultToSheet_(res, 'Screener ' + exchange + ' (BQ)');
  return res.rows.length;
}

/**
 * Company profile row(s) from the flat companies table.
 * @param {string} symbol  Ticker.
 * @returns {number}       Rows written.
 */
function pullCompany(symbol) {
  symbol = (symbol || 'VNM').toUpperCase();
  var sql =
    'SELECT symbol, company_name, english_name, short_name, exchange, sector,' +
    ' subsector, industry, listing_date, established_date, outstanding_shares,' +
    ' listed_shares, website, phone, address, business_description' +
    ' FROM ' + fq_('companies') +
    " WHERE UPPER(symbol) = '" + sqlLit_(symbol) + "'";
  var res = bqQuery_(sql);
  writeResultToSheet_(res, symbol + ' Company (BQ)');
  return res.rows.length;
}

/** All symbols with exchange + industry from the stocks table. */
function pullListing() {
  var sql =
    'SELECT symbol, company_name, exchange, industry, sector, is_active' +
    ' FROM ' + fq_('stocks') +
    ' ORDER BY symbol';
  var res = bqQuery_(sql);
  writeResultToSheet_(res, 'Listing (BQ)');
  return res.rows.length;
}

/** Latest value per index from stock_indices. */
function pullMarketIndices() {
  var sql =
    'WITH ranked AS (' +
    '  SELECT index_code, time, open, high, low, close, volume, change, change_pct,' +
    '   ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY time DESC) AS rn' +
    '  FROM ' + fq_('stock_indices') +
    ')' +
    ' SELECT * EXCEPT(rn) FROM ranked WHERE rn = 1 ORDER BY index_code';
  var res = bqQuery_(sql);
  writeResultToSheet_(res, 'Market Indices (BQ)');
  return res.rows.length;
}


// ===========================================================================
// Dashboard + diagnostics
// ===========================================================================

/**
 * Refresh a dashboard for the watchlist: a consolidated latest-ratios tab
 * (one row per ticker) plus a per-ticker income statement tab.
 * Attach to a time-driven trigger for scheduled refreshes.
 */
function refreshDashboard() {
  var list = CONFIG.watchlist && CONFIG.watchlist.length ? CONFIG.watchlist : ['VNM'];
  var inList = "'" + list.map(function (s) { return sqlLit_(String(s).toUpperCase()); }).join("','") + "'";

  // 1) Latest ratio row per watchlist ticker, one tab.
  var sql =
    'WITH ranked AS (' +
    '  SELECT symbol, fiscal_year, fiscal_quarter, period_type,' +
    '   pe_ratio, pb_ratio, roe, roa, net_margin, eps, debt_to_equity,' +
    '   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY fiscal_year DESC, fiscal_quarter DESC) AS rn' +
    '  FROM ' + fq_('financial_ratios') +
    '  WHERE UPPER(symbol) IN (' + inList + ')' +
    ')' +
    ' SELECT * EXCEPT(rn) FROM ranked WHERE rn = 1 ORDER BY symbol';
  runSql(sql, 'Ratios Summary (BQ)');

  // 2) Per-ticker income statements.
  for (var i = 0; i < list.length; i++) {
    try { pullFinancials(list[i], 'income', 8, 'year'); }
    catch (e) { Logger.log('Financials failed for ' + list[i] + ': ' + e.message); }
  }
  Logger.log('Dashboard refreshed for ' + list.length + ' tickers.');
}

/** List all tables in the dataset with row counts + size. Also a health check. */
function listTables() {
  var metadata = '`' + CONFIG.datasetProject + '.region-' + String(CONFIG.location).toLowerCase() + '.INFORMATION_SCHEMA.';
  var sql =
    'SELECT t.table_name, t.table_type,' +
    ' ROUND(IFNULL(s.active_logical_bytes, 0) / POW(1024, 2), 1) AS active_logical_mb' +
    ' FROM ' + metadata + 'TABLES AS t' +
    ' LEFT JOIN ' + metadata + 'TABLE_STORAGE AS s' +
    ' USING (table_catalog, table_schema, table_name)' +
    " WHERE t.table_schema = '" + sqlLit_(CONFIG.datasetId) + "'" +
    ' ORDER BY active_logical_mb DESC, t.table_name';
  var res = bqQuery_(sql);
  writeResultToSheet_(res, 'Tables (BQ)');
  try {
    SpreadsheetApp.getUi().alert('Listed ' + res.rows.length + ' tables. See "Tables (BQ)" tab.');
  } catch (e) {}
  return res.rows.length;
}


// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Escape a value for inlining into a single-quoted SQL string literal.
 * Ticker symbols and exchange codes are the only user input reaching SQL here,
 * and they are upper-cased first; this doubles single quotes as defense in
 * depth. For arbitrary user SQL use the ⚙ SQL sheet (explicit, user-owned).
 * @param {string} s
 * @returns {string}
 */
function sqlLit_(s) {
  return String(s).replace(/'/g, "''");
}

function assertSheetCellBudget_(rows, columns) {
  var cells = rows * columns;
  var limit = Number(CONFIG.maxSheetCells) || 10000000;
  if (cells > limit) throw new Error('Sheet cell budget exceeded: ' + cells + ' cells exceeds ' + limit + '. Narrow the request or raise CONFIG.maxSheetCells within the Google Sheets limit.');
}

function validateReadOnlySql_(sql) {
  var source = String(sql || '').trim();
  if (!source) throw new Error('SQL is required.');
  var code = '';
  var quote = '';
  for (var i = 0; i < source.length; i++) {
    var ch = source.charAt(i);
    var next = source.charAt(i + 1);
    if (quote) {
      if (ch === quote) {
        if (next === quote) {
          i++;
        } else {
          quote = '';
        }
      } else if (ch === '\\' && quote !== '`') {
        i++;
      }
      code += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      code += ' ';
      continue;
    }
    if (ch === '#' || (ch === '-' && next === '-') || (ch === '/' && next === '*') || (ch === '*' && next === '/')) {
      throw new Error('SQL comments are not allowed.');
    }
    code += ch;
  }
  if (quote) throw new Error('SQL contains an unterminated quoted value.');
  var semicolons = code.match(/;/g) || [];
  if (semicolons.length > 1 || (semicolons.length === 1 && !/^\s*[\s\S]*;\s*$/.test(code))) {
    throw new Error('SQL must contain one statement and may have only one trailing semicolon.');
  }
  code = code.replace(/;\s*$/, '').trim();
  if (!/^(SELECT|WITH)\b/i.test(code)) throw new Error('Only a single read-only SELECT or WITH query is allowed.');
  var forbidden = /\b(ALTER|ANALYZE|ASSERT|BEGIN|BREAK|CALL|COMMIT|CONTINUE|COPY|CREATE|DECLARE|DELETE|DROP|EXECUTE|EXPORT|FOR|GRANT|IF|INSERT|LOAD|LOOP|MERGE|RAISE|RETURN|REVOKE|ROLLBACK|SET|TRUNCATE|UPDATE|WHILE)\b/i;
  if (forbidden.test(code)) throw new Error('SQL contains a disallowed statement or scripting keyword.');
  return source.replace(/;\s*$/, '').trim();
}

function sqlValidatorSelfCheck() {
  var accepted = ['SELECT 1', 'WITH x AS (SELECT 1) SELECT * FROM x', "SELECT ';' AS value"];
  var rejected = ['SELECT 1; SELECT 2', 'DELETE FROM t', 'SELECT 1 -- bypass', 'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'];
  for (var i = 0; i < accepted.length; i++) validateReadOnlySql_(accepted[i]);
  for (var j = 0; j < rejected.length; j++) {
    var failed = false;
    try { validateReadOnlySql_(rejected[j]); } catch (e) { failed = true; }
    if (!failed) throw new Error('SQL validator accepted: ' + rejected[j]);
  }
  return 'SQL validator self-check passed.';
}

/**
 * Resolve target Spreadsheet: active when bound, else CONFIG.spreadsheetId.
 * @returns {Spreadsheet}
 */
function resolveSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  if (!CONFIG.spreadsheetId) {
    throw new Error(
      'No active spreadsheet. This script is standalone — set CONFIG.spreadsheetId ' +
      'to the target Sheet ID, or create the script from inside a Sheet.'
    );
  }
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

/**
 * Write a {headers, rows} result into a named tab (clears/creates the tab).
 * @param {{headers:string[], rows:Array<Array>}} res
 * @param {string} sheetName
 */
function writeResultToSheet_(res, sheetName) {
  var headers = res.headers || [];
  var rows = res.rows || [];
  if (headers.length === 0) {
    headers = ['result'];
    rows = [['(query returned no columns)']];
  }
  var values = rows.map(function (row) {
    return row.map(function (v) {
      if (v === '' || v === null || v === undefined) return '';
      if (typeof v === 'string' && v !== '' && !isNaN(v) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(v)) return Number(v);
      return v;
    });
  });
  assertSheetCellBudget_(values.length + 1, headers.length);
  var ss = resolveSpreadsheet_();
  var name = sheetName || 'BQ Result';
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  else sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  Logger.log('Wrote ' + rows.length + ' rows, ' + headers.length + ' cols to "' + name + '".');
}


// ===========================================================================
// Demo — quick end-to-end smoke test from the editor
// ===========================================================================

/**
 * Run this first to verify setup: lists tables (proves BigQuery service +
 * auth + billing project work), then pulls VNM income statement + prices.
 */
function demo() {
  listTables();
  pullFinancials('VNM', 'income', 8, 'year');
  pullPrices('VNM', 180);
}
