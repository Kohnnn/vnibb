'use client';

import { BarChart3 } from 'lucide-react';
import { useAnalystEstimates } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface AnalystEstimatesWidgetProps {
  symbol: string;
  isEditing?: boolean;
  onRemove?: () => void;
}

type EstimateRow = {
  period?: string;
  eps_estimate?: number | null;
  revenue_estimate?: number | null;
};

function formatEstimate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function AnalystEstimatesWidget({ symbol }: AnalystEstimatesWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useAnalystEstimates(
    symbol,
    Boolean(symbol)
  );

  const payload = data?.data;
  const rows = (payload?.data ?? []) as EstimateRow[];
  const hasRows = rows.length > 0;

  if (!symbol) {
    return (
      <WidgetEmpty
        message="Select a symbol to view analyst estimates"
        icon={<BarChart3 size={18} />}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="pb-2 border-b border-[var(--border-subtle)]">
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasRows}
          note="Consensus estimates"
          align="right"
        />
      </div>

      <div className="pt-3 space-y-3 flex-1 overflow-auto">
        {isLoading && !hasRows ? (
          <WidgetSkeleton lines={5} />
        ) : error && !hasRows ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : (
          <>
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Analyst Estimates</div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {payload?.message ||
                  'Data sourced from consensus providers. Coming Soon for Vietnam market.'}
              </p>
              <div className="mt-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Source: {payload?.source || 'unavailable'}
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-secondary)]">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {hasRows ? (
                    <>
                      {rows.map((row, index) => (
                        <tr
                          key={`${row.period || 'period'}-${index}`}
                          className="border-t border-[var(--border-subtle)]"
                        >
                          <td className="px-3 py-2 text-[var(--text-secondary)]">EPS Estimate</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{row.period || '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-[var(--text-primary)]">
                            {formatEstimate(row.eps_estimate)}
                          </td>
                        </tr>
                      ))}
                      {rows.map((row, index) => (
                        <tr
                          key={`revenue-${row.period || 'period'}-${index}`}
                          className="border-t border-[var(--border-subtle)]"
                        >
                          <td className="px-3 py-2 text-[var(--text-secondary)]">Revenue Estimate</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{row.period || '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-[var(--text-primary)]">
                            {formatEstimate(row.revenue_estimate)}
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <>
                      <tr className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-2 text-[var(--text-secondary)]">EPS Estimate</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">FY+1</td>
                        <td className="px-3 py-2 text-right text-[var(--text-muted)]">Coming Soon</td>
                      </tr>
                      <tr className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-2 text-[var(--text-secondary)]">Revenue Estimate</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">FY+1</td>
                        <td className="px-3 py-2 text-right text-[var(--text-muted)]">Coming Soon</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AnalystEstimatesWidget;
