#!/usr/bin/env node
/**
 * Deterministic Apps Script harness for apps_script_client.gs.
 *
 * Executes the actual client functions (fetchBounded_, provenanceRows_,
 * writeProvenanceBlock_, cellValue_, boundedClampLimit_, assertBoundedRange_,
 * readBoundedEnvelope_, pullBounded*) against scriptable mocks of the Apps
 * Script runtime — no Google services, no network. The client file is loaded
 * verbatim, so the tests exercise the real code a Sheet runs.
 *
 * Usage:
 *   node apps/api/scripts/apps_script_client_test.js
 *
 * Exits 0 when every check passes, 1 otherwise.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CLIENT_PATH = path.join(__dirname, "apps_script_client.gs");
const source = fs.readFileSync(CLIENT_PATH, "utf8");

// ---------------------------------------------------------------------------
// Apps Script runtime mocks
// ---------------------------------------------------------------------------

let scriptProperties = {};
let sheetsByName = {};
let nextSheetId = 1;

function resetRuntime() {
  scriptProperties = {};
  sheetsByName = {};
  nextSheetId = 1;
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.clearCount = 0;
    this.rows = [];
    this.frozenRows = 0;
  }
  getRange(row, col, numRows, numCols) {
    const fake = this;
    return {
      setValues(values) {
        fake.rows = values;
      },
      setFontWeight() {},
      setColumnWidth() {},
    };
  }
  setValues(values) { this.rows = values; }
  clear() { this.clearCount += 1; this.rows = []; }
  setFrozenRows(n) { this.frozenRows = n; }
  setColumnWidth() {}
  getLastRow() { return 0; }
}

function makeSpreadsheetMock() {
  return {
    getActiveSpreadsheet() { return null; },
    openById(id) {
      if (id !== "sheet-123") throw new Error("unknown spreadsheet id");
      return makeSpreadsheetMock();
    },
    getSheetByName(name) {
      return sheetsByName[name] || null;
    },
    insertSheet(name) {
      const sheet = new FakeSheet(name);
      sheetsByName[name] = sheet;
      return sheet;
    },
  };
}

function httpResponse_(payload) {
  return {
    getResponseCode() { return 200; },
    getContentText() { return JSON.stringify(payload); },
  };
}

const requests = [];
let requestIndex = 0;
const responses = [];

const runtime = {
  CONFIG: undefined, // set by the loaded client
  console,
  Logger: { log() {}, },
  UrlFetchApp: {
    fetch(url, options) {
      requests.push({ url, options });
      const index = requestIndex++;
      if (index >= responses.length) {
        throw new Error("Harness: no mock response for request " + index + " — " + url);
      }
      return httpResponse_(responses[index](url));
    },
  },
  Utilities: {
    sleep() {},
    formatDate(date, tz, fmt) {
      const pad = (n) => String(n).padStart(2, "0");
      return (
        date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate())
      );
    },
  },
  Session: { getScriptTimeZone() { return "UTC"; } },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return scriptProperties[key] || null; },
        setProperty(key, value) { scriptProperties[key] = value; },
      };
    },
  },
  SpreadsheetApp: makeSpreadsheetMock(),
};


function loadClient() {
  resetRuntime();
  requestIndex = 0;
  responses.length = 0;
  requests.length = 0;
  const context = vm.createContext({
    ...runtime,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Error,
    encodeURIComponent,
    isNaN,
    isFinite,
  });
  vm.runInContext(source, context, { filename: "apps_script_client.gs" });
  return context;
}

// ---------------------------------------------------------------------------
// Tiny check helpers
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function check(condition, label, detail) {
  checks++;
  if (condition) {
    console.log("  ok  " + label);
  } else {
    failures++;
    console.error("  FAIL " + label + (detail ? " — " + detail : ""));
  }
}

function jsonOf(obj) {
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function boundedResponse(meta, data, error) {
  return { data: data || [], meta: meta, error: error || null };
}

const HISTORY_ROW = { symbol: "VNM", time: "2025-01-09", open: 41.5, high: 42.5, low: 41.0, close: 42.0, volume: 1000 };
const SCREENER_ROW = { symbol: "VNM", trade_date: "2025-07-15", pe: 18.5, roe: 28.5 };

function okMeta(overrides) {
  return Object.assign({
    dataset: "historical",
    availability: "available",
    source: "vnstock:VCI",
    source_date: "2025-01-09",
    retrieved_at: "2026-10-04T00:00:00Z",
    count: 1,
    limit: 2000,
    query: { dataset: "historical", limit: 2000, symbol: "VNM" },
    limitations: ["Only dates the provider returns are present; missing sessions are absent, not zero."],
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ctx = loadClient();
const CONFIG = ctx.CONFIG;
CONFIG.baseUrl = "https://test-host/api/v1/apps-script";
CONFIG.spreadsheetId = "sheet-123";
scriptProperties.VNIBB_APPS_SCRIPT_KEY = "test-key";

console.log("apps_script_client.gs harness\n");

console.log("— bounded envelope handling —");

responses.push(() => boundedResponse(okMeta(), [HISTORY_ROW]));
let envelope = ctx.fetchBounded_("historical", { symbol: "VNM", start_date: "2025-01-01", end_date: "2025-01-31", interval: "1D", limit: 10 });
check(envelope.meta.source_date === "2025-01-09", "fetchBounded_ parses meta", jsonOf(envelope.meta));
check(envelope.data.length === 1 && envelope.data[0].symbol === "VNM", "fetchBounded_ parses data");
check(
  requests[0].url.indexOf("/bounded/historical?symbol=VNM") !== -1 &&
  requests[0].options.headers["X-API-Key"] === "test-key",
  "bounded request carries auth header",
  requests[0].url
);

responses.push(() => boundedResponse(okMeta({ availability: "empty", source_date: null, count: 0 }), [], null));
let empty = ctx.fetchBounded_("listing", { exchange: "HOSE", limit: 5 });
check(empty.meta.availability === "empty" && empty.data.length === 0, "empty availability round-trips");

let unknownDataset = false;
try { ctx.fetchBounded_("nonsense", {}); } catch (e) { unknownDataset = true; }
check(unknownDataset, "fetchBounded_ rejects unknown dataset");

console.log("— provenance block —");

let prov = ctx.provenanceRows_(okMeta());
check(prov.some((r) => r[0] === "source_date" && r[1] === "2025-01-09"), "provenance rows carry source_date");
prov = ctx.provenanceRows_(okMeta({ source_date: null, availability: "unavailable", error: null }));
let unknownRow = prov.filter((r) => r[0] === "source_date");
check(unknownRow.length === 1 && unknownRow[0][1] === "unknown", "unknown source date stays 'unknown' not fetch time");
let limitationRows = prov.filter((r) => r[0].indexOf("limitation") === 0);
check(limitationRows.length >= 1, "limitations written as rows", jsonOf(limitationRows));

console.log("— safe scalar writes —");

check(ctx.cellValue_("api_key", "secret") === "[redacted]", "secret-like column redacted");
check(ctx.cellValue_("X-API-Key", "secret") === "[redacted]", "X-API-Key header-like column redacted");
check(ctx.cellValue_("close", 42000) === 42000, "prices pass through untouched (no silent re-unit)");
check(ctx.cellValue_("nested", { a: 1 }) === '{"a":1}', "nested values JSON-stringified");
check(ctx.cellValue_("pe", null) === "", "null becomes empty cell");

ctx.writeProvenanceBlock_(okMeta(), "Prov Tab");
let provSheet = sheetsByName["Prov Tab"];
check(provSheet && provSheet.rows.length >= 8, "provenance block written to its tab", jsonOf(provSheet && provSheet.rows));
check(provSheet.rows.some((r) => r[0] === "query"), "query written as a row (no keys)");

console.log("— bounds —");

check(ctx.boundedClampLimit_(99999, 100) === 2000, "limit clamped to boundedLimitMax");
check(ctx.boundedClampLimit_(0, 100) === 100, "zero limit falls back to default");
check(ctx.boundedClampLimit_("", 5) === 5, "empty limit falls back");

let rangeError = false;
try { ctx.assertBoundedRange_("2000-01-01", "2026-01-01"); } catch (e) { rangeError = true; }
check(rangeError, "oversized historical range rejected");

rangeError = false;
try { ctx.assertBoundedRange_("2026-02-01", "2026-01-01"); } catch (e) { rangeError = true; }
check(rangeError, "inverted historical range rejected");

ctx.assertBoundedRange_("2025-01-01", "2025-12-31");
check(true, "in-bounds historical range accepted");

console.log("— bounded pulls write data + provenance —");

responses.push(() => boundedResponse(okMeta({ dataset: "financials", source: null, source_date: null, count: 1, limit: 5, limitations: ["Statement period labels are reporting periods, not publication dates."] }), [{ symbol: "VNM", period: "2025", revenue: 1.5 }]));
let rows = ctx.pullBoundedFinancials("VNM", "income", "year", 5);
check(rows.length === 1 && rows[0].symbol === "VNM", "pullBoundedFinancials returns written rows");
check(!!sheetsByName["VNM income (year)"], "financial data tab written");
check(!!sheetsByName["VNM income (year) provenance"], "financial provenance tab written");

responses.push(() => boundedResponse(okMeta({ dataset: "screener", source: "fallback_cache", source_date: "2025-07-15", count: 1 }), [SCREENER_ROW]));
let screener = ctx.pullBoundedScreener("HOSE", 100, null, "KBS");
check(screener.length === 1, "pullBoundedScreener returns rows");
check(!!sheetsByName["Screener (HOSE) provenance"], "screener provenance tab written");

responses.push(() => boundedResponse(okMeta({ dataset: "historical", source: "merged", source_date: "2025-01-09", count: 1 }), [HISTORY_ROW]));
let hist = ctx.pullBoundedHistorical("VNM", "2025-01-01", "2025-01-31", "1D", 10);
check(hist.length === 1, "pullBoundedHistorical returns rows");
check(!!sheetsByName["VNM OHLCV provenance"], "historical provenance tab written");

// Unavailable result: no data tab, provenance tab still written with the error.
responses.push(() => boundedResponse(okMeta({ dataset: "financials", availability: "unavailable", source: "unavailable", source_date: null, count: 0, limitations: ["The serving pipeline did not return data for this request."] }), [], "Data unavailable from the serving pipeline."));
let unavailableError = null;
try { ctx.pullBoundedFinancials("ZZZ", "income", "year", 5); } catch (error) { unavailableError = error; }
check(unavailableError && unavailableError.message.includes('data unavailable'), "unavailable pull surfaces actionable error");
check(!sheetsByName["ZZZ income (year)"], "no data tab for unavailable");
check(!!sheetsByName["ZZZ income (year) provenance"], "provenance tab still written for unavailable");

responses.push(() => [{ symbol: 'VNM', period: '2025', revenue: 123 }]);
check(ctx.VNIBB_FINANCIAL('VNM', 'revenue', 'income', 'year', 0) === 123, 'legacy financial formula keeps array contract');
responses.push(() => [{ symbol: 'VNM', roe: 28.5 }]);
check(ctx.VNIBB_RATIO('VNM', 'roe', 'year') === 28.5, 'legacy ratio formula keeps array contract');
responses.push(() => ({ data: { symbol: 'VNM', price: 42 } }));
check(ctx.VNIBB_QUOTE('VNM') === 42, 'legacy quote formula keeps wrapper contract');
let malformedError = false;
try { ctx.readBoundedEnvelope_({data: [1, 2], meta: {limit: 1}}); } catch (error) { malformedError = true; }
check(malformedError, 'over-limit envelope rejected before writing');
check(ctx.cellValue_('name', '=IMPORTDATA("https://bad")').startsWith("'="), 'formula strings written literally');
check(ctx.cellValue_('note', 'test-key') === '[redacted]', 'actual key value never written to cells');

responses.push(() => boundedResponse(okMeta({ dataset: 'financials', availability: 'empty', count: 0, limit: 5, source_date: null }), []));
ctx.pullBoundedFinancials('VNM', 'income', 'year', 5);
check(sheetsByName['VNM income (year)'].rows.length === 0, 'empty pull clears previous data');
check(sheetsByName['VNM income (year) provenance'].rows.some(row => row[0] === 'availability' && row[1] === 'empty'), 'empty pull writes truthful provenance');

responses.push(() => boundedResponse(okMeta({ dataset: 'financials', availability: 'available', count: 2, limit: 2, source_date: null, query: { dataset: 'financials', limit: 2, symbol: 'VNM', statement_type: 'income', period: 'quarter' } }), [{ symbol: 'VNM', period: 'Q1-2025' }, { symbol: 'VNM', period: 'Q2-2025' }]));
let quarterly = ctx.pullBoundedFinancials('VNM', 'income', 'quarter', 2);
check(quarterly.length === 2, 'quarterly pull returns rows');
check(!!sheetsByName['VNM income (quarter) provenance'], 'quarterly provenance tab distinct from annual');
check(sheetsByName['VNM income (quarter) provenance'].rows.some(row => row[0] === 'query' && row[1].indexOf('quarter') !== -1), 'quarterly provenance records its own query');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n" + checks + " checks, " + failures + " failed");
if (failures > 0) process.exit(1);
process.exit(0);
