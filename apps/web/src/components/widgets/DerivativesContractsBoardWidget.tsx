'use client';

import { useMemo, useState } from 'react';
import { Search, Sigma, TimerReset } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useDerivativesContracts } from '@/lib/queries';
import { formatDate } from '@/lib/format';

interface DerivativesContractsBoardWidgetProps {
  id: string;
  hideHeader?: boolean;
  onRemove?: () => void;
}

function daysUntilExpiry(expiry: string): number | null {
  const parsed = new Date(expiry)
  if (Number.isNaN(parsed.getTime())) return null
  const diffMs = parsed.getTime() - Date.now()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

export function DerivativesContractsBoardWidget({
  id,
  hideHeader,
  onRemove,
}: DerivativesContractsBoardWidgetProps) {
  const [search, setSearch] = useState('')
  const contractsQuery = useDerivativesContracts(true)

  const contracts = useMemo(() => {
    const base = contractsQuery.data?.data || []
    const normalized = search.trim().toLowerCase()
    if (!normalized) return base
    return base.filter((item) => {
      return item.symbol.toLowerCase().includes(normalized)
        || item.name.toLowerCase().includes(normalized)
    })
  }, [contractsQuery.data?.data, search])

  const hasData = contracts.length > 0

  return (
    <WidgetContainer
      title="Derivatives Contracts"
      widgetId={id}
      onRefresh={() => void contractsQuery.refetch()}
      onClose={onRemove}
      isLoading={contractsQuery.isLoading && !hasData}
      hideHeader={hideHeader}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter contracts..."
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500"
              />
            </div>
            <WidgetMeta
              updatedAt={contractsQuery.dataUpdatedAt}
              isFetching={contractsQuery.isFetching && hasData}
              note="Contracts board"
              align="right"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {contractsQuery.isLoading && !hasData ? (
            <WidgetSkeleton lines={7} />
          ) : contractsQuery.error && !hasData ? (
            <WidgetError error={contractsQuery.error as Error} onRetry={() => void contractsQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No derivatives contracts available." icon={<Sigma size={18} />} />
          ) : (
            <div className="space-y-2">
              {contracts.map((contract) => {
                const daysLeft = daysUntilExpiry(contract.expiry)
                return (
                  <div key={contract.symbol} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{contract.symbol}</div>
                        <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{contract.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Expiry</div>
                        <div className="text-xs font-medium text-[var(--text-primary)]">{formatDate(contract.expiry)}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1">
                        <TimerReset size={10} />
                        {daysLeft === null ? 'Unknown tenor' : `${daysLeft} days to expiry`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  )
}

export default DerivativesContractsBoardWidget
