#!/usr/bin/env bash

BASE_URL="${VNIBB_API_BASE_URL:-https://213.35.101.237.sslip.io}"
API_BASE="${BASE_URL%/}/api/v1"

SYMBOLS=(VNM FPT TCB HPG VCI SHS BSR HUG IPA)
EQUITY_ENDPOINTS=(profile quote financial-ratios income-statement balance-sheet cash-flow shareholders dividends calendar estimates)
MARKET_ENDPOINTS=(indices sectors top-movers)
QUANT_WIDGETS=(volume-flow rsi-seasonal bollinger-squeeze macd-crossover ema-respect drawdown-recovery parkinson-volatility gap-analysis sortino-monthly volume-profile atr-regime gap-fill-stats obv-divergence amihud-illiquidity drawdown-deep-dive hurst-market-structure volume-delta gamma-exposure momentum earnings-quality smart-money relative-rotation)
RS_ENDPOINTS=(leaders laggards gainers)

pass_count=0
fail_count=0
errors=()

check_endpoint() {
  local url="$1"
  local label="$2"
  local code

  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url") || code="000"

  if [[ "$code" == "200" ]]; then
    pass_count=$((pass_count + 1))
  else
    fail_count=$((fail_count + 1))
    errors+=("FAIL: ${label} -> ${code}")
  fi
}

for endpoint in live ready health/; do
  check_endpoint "${BASE_URL%/}/${endpoint}" "/${endpoint}"
done

for symbol in "${SYMBOLS[@]}"; do
  for endpoint in "${EQUITY_ENDPOINTS[@]}"; do
    check_endpoint "${API_BASE}/equity/${symbol}/${endpoint}" "equity/${symbol}/${endpoint}"
  done
done

for endpoint in "${MARKET_ENDPOINTS[@]}"; do
  check_endpoint "${API_BASE}/market/${endpoint}" "market/${endpoint}"
done

for symbol in VCI VNM; do
  for widget in "${QUANT_WIDGETS[@]}"; do
    check_endpoint "${API_BASE}/quant/${symbol}/${widget}?period=1Y" "quant/${symbol}/${widget}"
  done
done

for endpoint in "${RS_ENDPOINTS[@]}"; do
  check_endpoint "${API_BASE}/rs/${endpoint}" "rs/${endpoint}"
done

printf '================================\n'
printf 'API Smoke Test Results\n'
printf 'PASS: %s | FAIL: %s\n' "$pass_count" "$fail_count"
printf '================================\n'

if (( ${#errors[@]} > 0 )); then
  printf '\nFailures:\n'
  printf '%s\n' "${errors[@]}"
fi

if (( fail_count > 0 )); then
  exit 1
fi
