'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Search, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { useDerivativesContracts, useDerivativesHistory } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { formatAxisValue, formatNumber } from '@/lib/units';

interface DerivativesPriceHistoryWidgetProps {
  id: string;
  config?: Record<string, unknown>;
  hideHeader?: boolean;
  onRemove?: () => void;
}

export function DerivativesPriceHistoryWidget({
  id,
  config,
  hideHeader,
  onRemove,
}: DerivativesPriceHistoryWidgetProps) {
  const contractsQuery = useDerivativesContracts(true)
  const defaultSymbol = typeof config?.contractSymbol === 'string' ? config.contractSymbol : ''
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [search, setSearch] = useState(defaultSymbol)

  useEffect(() => {
    if (symbol) return
    const first = contractsQuery.data?.data?.[0]?.symbol
    if (first) {
      setSymbol(first)
      setSearch(first)
    }
  }, [contractsQuery.data?.data, symbol])

  const historyQuery = useDerivativesHistory(symbol, { enabled: Boolean(symbol) })
  const chartData = useMemo(
    () => (historyQuery.data?.data || []).map((row) => ({
      time: formatDate(row.time),
      close: row.close,
      volume: row.volume,
    })),
    [historyQuery.data?.data]
  )

  const latest = historyQuery.data?.data?.[historyQuery.data.data.length - 1]

  return (
    <WidgetContainer
      title="Derivatives Price History"
      widgetId={id}
      onRefresh={() => void historyQuery.refetch()}
      onClose={onRemove}
      isLoading={historyQuery.isLoading && chartData.length === 0}
      hideHeader={hideHeader}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                list={`derivatives-contracts-${id}`}
                value={search}
                onChange={(event) => setSearch(event.target.value.toUpperCase())}
                onBlur={() => {
                  const match = contractsQuery.data?.data?.find((item) => item.symbol === search.toUpperCase())
                  if (match) {
                    setSymbol(match.symbol)
                  }
                }}
                placeholder="Select contract"
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500"
              />
              <datalist id={`derivatives-contracts-${id}`}>
                {(contractsQuery.data?.data || []).map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.name}</option>
                ))}
              </datalist>
            </div>
            <WidgetMeta
              updatedAt={historyQuery.dataUpdatedAt}
              isFetching={historyQuery.isFetching && chartData.length > 0}
              note={symbol || 'Select contract'}
              align="right"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {historyQuery.isLoading && chartData.length === 0 ? (
            <WidgetSkeleton lines={7} />
          ) : historyQuery.error && chartData.length === 0 ? (
            <WidgetError error={historyQuery.error as Error} onRetry={() => void historyQuery.refetch()} />
          ) : chartData.length === 0 ? (
            <WidgetEmpty message="No derivatives price history available." icon={<LineChart size={18} />} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <MiniMetric label="Latest close" value={formatNumber(latest?.close ?? null, { decimals: 2 })} />
                <MiniMetric label="Latest volume" value={formatNumber(latest?.volume ?? null, { decimals: 0 })} />
                <MiniMetric label="Records" value={formatNumber(historyQuery.data?.count ?? chartData.length, { decimals: 0 })} />
                <MiniMetric label="Range" value={`${chartData[0]?.time || '-'} to ${chartData[chartData.length - 1]?.time || '-'}`} />
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <TrendingUp size={12} />
                  Close price
                </div>
                <ChartMountGuard className="min-h-[220px]" minHeight={220}>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval={chartData.length > 12 ? Math.max(1, Math.ceil(chartData.length / 8)) - 1 : 0} minTickGap={12} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => formatAxisValue(value)} width={56} />
                      <Tooltip formatter={(value: number | string | undefined) => formatNumber(typeof value === 'number' ? value : Number(value), { decimals: 2 })} />
                      <Area type="monotone" dataKey="close" stroke="#38bdf8" fill="rgba(56,189,248,0.18)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  )
}

export default DerivativesPriceHistoryWidget
