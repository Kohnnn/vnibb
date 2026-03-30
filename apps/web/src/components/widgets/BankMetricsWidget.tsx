'use client';

import { memo, useMemo } from 'react';
import { Building2, Landmark, ShieldCheck, TrendingUp } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { useFinancialRatios } from '@/lib/queries';
import { formatFinancialPeriodLabel, periodSortKey } from '@/lib/financialPeriods';
import { formatNumber, formatPercent } from '@/lib/units';

interface BankMetricsWidgetProps {
  id: string;
  symbol: string;
  isEditing?: boolean;
  onRemove?: () => void;
}

const BANK_METRIC_LABELS: Record<string, string> = {
  loan_to_deposit: 'Loan / Deposit',
  casa_ratio: 'CASA Ratio',
  deposit_growth: 'Deposit Growth',
  nim: 'NIM',
  equity_to_assets: 'Equity / Assets',
  asset_yield: 'Asset Yield',
  credit_cost: 'Credit Cost',
  provision_coverage: 'Provision Coverage',
  roe: 'ROE',
  roa: 'ROA',
};

const RATIO_KEYS = new Set(['loan_to_deposit']);
const PERCENT_KEYS = new Set([
  'casa_ratio',
  'deposit_growth',
  'nim',
  'equity_to_assets',
  'asset_yield',
  'credit_cost',
  'provision_coverage',
  'roe',
  'roa',
]);

const METRIC_GROUPS = [
  {
    id: 'funding',
    label: 'Funding',
    metrics: ['loan_to_deposit', 'casa_ratio', 'deposit_growth'],
  },
  {
    id: 'profitability',
    label: 'Profitability',
    metrics: ['nim', 'asset_yield', 'roe', 'roa'],
  },
  {
    id: 'risk',
    label: 'Risk & Capital',
    metrics: ['equity_to_assets', 'credit_cost', 'provision_coverage'],
  },
] as const;

function formatMetricValue(metricKey: string, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  if (PERCENT_KEYS.has(metricKey)) return formatPercent(value, { decimals: 2, input: 'percent' });
  if (RATIO_KEYS.has(metricKey)) return formatNumber(value, { decimals: 2 });
  return formatNumber(value, { decimals: 2 });
}

function BankMetricsWidgetComponent({ id, symbol, onRemove }: BankMetricsWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useFinancialRatios(symbol, {
    period: 'FY',
  });

  const ratios = useMemo(() => {
    const items = data?.data || [];
    return [...items].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period));
  }, [data?.data]);

  const latest = ratios[ratios.length - 1];
  const hasBankData = useMemo(() => {
    return ratios.some((row) =>
      METRIC_GROUPS.some((group) =>
        group.metrics.some((metricKey) => {
          const value = row?.[metricKey as keyof typeof row];
          return typeof value === 'number' && Number.isFinite(value);
        })
      )
    );
  }, [ratios]);

  const latestCards = useMemo(() => {
    if (!latest) return [];
    return [
      { key: 'loan_to_deposit', icon: Landmark, accent: 'text-sky-300' },
      { key: 'nim', icon: TrendingUp, accent: 'text-emerald-300' },
      { key: 'credit_cost', icon: ShieldCheck, accent: 'text-amber-300' },
      { key: 'equity_to_assets', icon: Building2, accent: 'text-cyan-300' },
    ].map((item) => ({
      ...item,
      value: latest[item.key as keyof typeof latest] as number | null | undefined,
    }));
  }, [latest]);

  const tableColumns = useMemo(
    () =>
      ratios.slice(-6).map((entry, index, items) => ({
        key: entry.period ?? `period_${index}`,
        label: formatFinancialPeriodLabel(entry.period, {
          mode: 'year',
          index,
          total: items.length,
        }),
        align: 'right' as const,
      })),
    [ratios]
  );

  const tableRows = useMemo<DenseTableRow[]>(() => {
    return METRIC_GROUPS.flatMap((group) => {
      const groupId = `bank:${group.id}`;
      const groupRows: DenseTableRow[] = [
        {
          id: groupId,
          label: group.label,
          values: {},
          isGroup: true,
        },
      ];

      for (const metricKey of group.metrics) {
        groupRows.push({
          id: metricKey,
          label: BANK_METRIC_LABELS[metricKey] || metricKey,
          parentId: groupId,
          indent: 12,
          values: Object.fromEntries(
            ratios.slice(-6).map((entry, index) => [
              tableColumns[index]?.key ?? `period_${index}`,
              entry[metricKey as keyof typeof entry],
            ])
          ),
        });
      }

      return groupRows;
    });
  }, [ratios, tableColumns]);

  const note = latest?.casa_ratio == null
    ? 'Annual bank analytics | CASA pending provider split'
    : 'Annual bank analytics';

  return (
    <WidgetContainer
      title="Bank Analytics"
      subtitle="Funding, profitability, and risk monitors"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasBankData}
      noPadding
      exportData={ratios}
      exportFilename={`bank_metrics_${symbol}`}
      widgetId={id}
      showLinkToggle
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasBankData}
            note={note}
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 scrollbar-hide">
          {isLoading && !hasBankData ? (
            <WidgetSkeleton variant="table" lines={6} />
          ) : error && !hasBankData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasBankData ? (
            <WidgetEmpty
              icon={<Building2 size={18} />}
              message={`Bank analytics are available for bank issuers. ${symbol} does not currently expose bank metrics.`}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {latestCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.key}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3"
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        <Icon size={12} className={card.accent} />
                        <span>{BANK_METRIC_LABELS[card.key]}</span>
                      </div>
                      <div className={`text-lg font-semibold ${card.accent}`}>
                        {formatMetricValue(card.key, card.value)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <DenseFinancialTable
                columns={tableColumns}
                rows={tableRows}
                sortable
                showTrend={false}
                storageKey={`bank-metrics:${id}:${symbol}`}
                valueFormatter={(value, row) =>
                  formatMetricValue(row.id, typeof value === 'number' ? value : Number(value))
                }
              />
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const BankMetricsWidget = memo(BankMetricsWidgetComponent);
export default BankMetricsWidget;
