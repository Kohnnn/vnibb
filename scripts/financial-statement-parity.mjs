#!/usr/bin/env node

const baseUrl = (process.env.NEXT_PUBLIC_API_URL || process.env.VNIBB_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const limit = Number(process.env.PARITY_LIMIT || process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 500);
const concurrency = Number(process.env.PARITY_CONCURRENCY || process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] || 12);
const symbolsArg = process.env.PARITY_SYMBOLS || process.argv.find((arg) => arg.startsWith('--symbols='))?.split('=')[1] || '';
const periodArg = process.env.PARITY_PERIODS || process.argv.find((arg) => arg.startsWith('--periods='))?.split('=')[1] || 'FY,Q1,Q2,Q3,Q4,TTM';
const endpointArg = process.env.PARITY_ENDPOINTS || process.argv.find((arg) => arg.startsWith('--endpoints='))?.split('=')[1] || 'income,balance,cashflow,ratios';
const periods = periodArg.split(',').map((item) => item.trim()).filter(Boolean);
const allEndpoints = [
  ['income', 'income-statement'],
  ['balance', 'balance-sheet'],
  ['cashflow', 'cash-flow'],
  ['ratios', 'financial-ratios'],
];
const endpointSet = new Set(endpointArg.split(',').map((item) => item.trim()).filter(Boolean));
const endpoints = allEndpoints.filter(([label]) => endpointSet.has(label));

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function hasUsefulValue(row) {
  if (!row || typeof row !== 'object') return false;
  return Object.entries(row).some(([key, value]) => {
    if (['symbol', 'period', 'statement_type', 'updated_at', 'raw_data'].includes(key)) return false;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }) || (row.raw_data && typeof row.raw_data === 'object' && Object.values(row.raw_data).some((value) => Number.isFinite(Number(value))));
}

async function getSymbols() {
  if (symbolsArg.trim()) {
    return symbolsArg.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean).slice(0, limit);
  }
  const listing = await fetchJson('/api/v1/listing/symbols');
  let rows = listing?.data || [];
  if (!rows.length) {
    const screenerLimit = Math.min(limit, 2000);
    const payload = await fetchJson(`/api/v1/screener/?limit=${screenerLimit}&sort=market_cap:desc`);
    rows = payload?.data?.items || payload?.data || [];
  }
  return rows.map((row) => row.symbol || row.ticker).filter(Boolean).slice(0, limit);
}

const symbols = await getSymbols();
const checks = symbols.flatMap((symbol) => endpoints.flatMap(([label, endpoint]) => periods.map((period) => ({ symbol, label, endpoint, period }))));
const failures = [];
let cursor = 0;

async function worker() {
  while (cursor < checks.length) {
    const check = checks[cursor];
    cursor += 1;
    const { symbol, label, endpoint, period } = check;
    try {
      const payload = await fetchJson(`/api/v1/equity/${symbol}/${endpoint}?period=${period}&limit=80`);
      const rows = payload?.data || [];
      const usefulRows = rows.filter(hasUsefulValue).length;
      if (!rows.length || !usefulRows) {
        failures.push({ symbol, label, period, rows: rows.length, usefulRows, error: payload?.error || '' });
      }
    } catch (error) {
      failures.push({ symbol, label, period, rows: 0, usefulRows: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

const totalChecks = symbols.length * endpoints.length * periods.length;
console.log(JSON.stringify({ baseUrl, symbols: symbols.length, totalChecks, concurrency, failures: failures.length, sampleFailures: failures.slice(0, 50) }, null, 2));

if (failures.length) {
  process.exitCode = 1;
}
