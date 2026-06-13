'use client';

import { useEffect, useState } from 'react';
import { Coins, RefreshCw, ExternalLink } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number | null;
  total_volume: number;
}

interface CryptoMarketFallbackProps {
  id: string;
  onRemove?: () => void;
  onDataChange?: (data: unknown) => void;
}

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h';
const COINGECKO_SOURCE_LABEL = 'CoinGecko (third-party fallback)';

function formatPrice(value: number): string {
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(8)}`;
}

function formatLargeNumber(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

/**
 * Native fallback for the TradingView Cryptocurrency Market widget when
 * the embed is blocked or fails to render (QA-v2 G6).
 *
 * Uses CoinGecko's free public API (no key required, ~50 req/min limit)
 * and refreshes on demand. Static during the cycle so we don't hammer
 * the API.
 */
export function CryptoMarketFallback({ id, onRemove, onDataChange }: CryptoMarketFallbackProps) {
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(COINGECKO_URL);
      if (!res.ok) {
        throw new Error(`CoinGecko request failed (${res.status})`);
      }
      const json = (await res.json()) as CryptoCoin[];
      setCoins(json);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load crypto market data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const hasData = coins.length > 0;

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: 'external',
      endpoint: 'https://api.coingecko.com/api/v3/...',
      sourceLabel: COINGECKO_SOURCE_LABEL,
      lastDataDate: updatedAt || undefined,
      derived: true,
      stale: Boolean(error && hasData),
      extra: {
        rows: coins,
      },
    }));
  }, [coins, error, hasData, onDataChange, updatedAt]);

  return (
    <WidgetContainer
      title="Cryptocurrency Market (Fallback)"
      widgetId={id}
      onRefresh={() => void load()}
      onClose={onRemove}
      isLoading={loading && !hasData}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <Coins size={12} className="text-amber-300" />
            <span>Top {coins.length} by market cap · CoinGecko</span>
          </div>
          <WidgetMeta updatedAt={updatedAt} note="TradingView fallback" align="right" />
        </div>

        {loading && !hasData ? (
          <div className="p-3">
            <WidgetSkeleton lines={10} />
          </div>
        ) : error && !hasData ? (
          <WidgetError error={error} onRetry={() => void load()} />
        ) : !hasData ? (
          <WidgetEmpty
            message="Crypto market data unavailable"
            detail="CoinGecko returned no rows. Try refresh."
            action={{ label: 'Refresh', onClick: () => void load() }}
          />
        ) : (
          <div className="flex-1 overflow-auto">
            {/* QA-v3 G6: ensure CHG% column never gets clipped by setting
                a min-width on the table and an explicit min-width on the
                CHG% column. The previous default Tailwind layout truncated
                the percent sign + decimal on narrow widget cells. */}
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[10px] uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Coin</th>
                  <th className="px-2 py-1.5 text-right">Price</th>
                  <th className="px-2 py-1.5 text-right" style={{ minWidth: 88 }}>24h %</th>
                  <th className="px-2 py-1.5 text-right">Mkt Cap</th>
                  <th className="px-2 py-1.5 text-right">Volume</th>
                </tr>
              </thead>
              <tbody>
                {coins.map((coin) => {
                  const change = coin.price_change_percentage_24h ?? 0;
                  const isUp = change >= 0;
                  return (
                    <tr key={coin.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)]/60">
                      <td className="px-2 py-1.5 font-mono text-[var(--text-muted)]">{coin.market_cap_rank}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-semibold text-[var(--text-primary)]">{coin.symbol.toUpperCase()}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{coin.name}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[var(--text-primary)] tabular-nums">
                        {formatPrice(coin.current_price)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums ${
                          isUp ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                        style={{ minWidth: 88 }}
                      >
                        {isUp ? '+' : ''}
                        {change.toFixed(2)}%
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[var(--text-secondary)] tabular-nums">
                        {formatLargeNumber(coin.market_cap)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[var(--text-secondary)] tabular-nums">
                        {formatLargeNumber(coin.total_volume)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-1.5 text-[9px] text-[var(--text-muted)]">
          <span>Source: {COINGECKO_SOURCE_LABEL}</span>
          <a
            href="https://www.coingecko.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
          >
            CoinGecko <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </WidgetContainer>
  );
}

export default CryptoMarketFallback;
