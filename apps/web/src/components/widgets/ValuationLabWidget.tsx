'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import { useTTMSnapshot, useStockQuote } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { runDcf, solveImpliedGrowth, type DcfAssumptions } from '@/lib/valuationLab'

interface ValuationLabWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
  onDataChange?: (data: WidgetDataPayload) => void
}

function pickNumber(record: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!record) return null
  for (const key of keys) {
    const raw = record[key]
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(value) && value !== 0) return value
  }
  return null
}

const DEFAULTS = {
  growthRate: 0.1,
  forecastYears: 5,
  discountRate: 0.13,
  terminalGrowth: 0.03,
}

export function ValuationLabWidget({ symbol, onDataChange }: ValuationLabWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data: ttm, isLoading: ttmLoading } = useTTMSnapshot(upperSymbol, Boolean(upperSymbol))
  const { data: quote } = useStockQuote(upperSymbol, Boolean(upperSymbol))

  // Seed base FCF from TTM cash flow (operating cash flow minus capex), with
  // graceful fallbacks. All values are user-editable below.
  const seededFcf = useMemo(() => {
    const cf = ttm?.data?.cash_flow as Record<string, unknown> | null | undefined
    const opCf = pickNumber(cf, ['operating_cash_flow', 'cash_from_operations', 'net_cash_from_operating', 'from_sale'])
    const capex = pickNumber(cf, ['capex', 'capital_expenditure', 'purchase_of_fixed_assets', 'invest'])
    const directFcf = pickNumber(cf, ['free_cash_flow', 'fcf'])
    if (directFcf !== null) return directFcf
    if (opCf !== null) return opCf - Math.abs(capex ?? 0)
    return null
  }, [ttm])

  const currentPrice = quote?.price ?? null

  const [baseFcf, setBaseFcf] = useState<number>(0)
  const [growthRate, setGrowthRate] = useState(DEFAULTS.growthRate)
  const [forecastYears, setForecastYears] = useState(DEFAULTS.forecastYears)
  const [discountRate, setDiscountRate] = useState(DEFAULTS.discountRate)
  const [terminalGrowth, setTerminalGrowth] = useState(DEFAULTS.terminalGrowth)
  const [netDebt, setNetDebt] = useState(0)
  const [shares, setShares] = useState(0)
  const [seeded, setSeeded] = useState(false)

  // One-time seed once data arrives (do not clobber user edits afterwards).
  useEffect(() => {
    if (seeded) return
    if (seededFcf !== null) {
      setBaseFcf(Number(seededFcf.toFixed(2)))
      setSeeded(true)
    }
  }, [seededFcf, seeded])

  // Reset seeding when the symbol changes.
  useEffect(() => {
    setSeeded(false)
    setBaseFcf(0)
    setNetDebt(0)
    setShares(0)
  }, [upperSymbol])

  const assumptions: DcfAssumptions = useMemo(
    () => ({
      baseFcf,
      growthRate,
      forecastYears,
      discountRate,
      terminalGrowth,
      netDebt,
      sharesOutstanding: shares,
    }),
    [baseFcf, growthRate, forecastYears, discountRate, terminalGrowth, netDebt, shares],
  )

  const result = useMemo(() => runDcf(assumptions), [assumptions])
  const impliedGrowth = useMemo(
    () => (currentPrice ? solveImpliedGrowth(assumptions, currentPrice) : null),
    [assumptions, currentPrice],
  )

  const upside =
    currentPrice && currentPrice > 0 && result.intrinsicPerShare !== null
      ? ((result.intrinsicPerShare - currentPrice) / currentPrice) * 100
      : null

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: false, compactHeight: 7 },
        provenance: {
          sourceLabel: 'Valuation Lab (user assumptions + TTM)',
          apiGroup: '/equity',
          endpoint: `/equity/${upperSymbol}/ttm`,
          localOnly: true,
        },
      },
      assumptions,
      result: {
        intrinsicPerShare: result.intrinsicPerShare,
        enterpriseValue: result.enterpriseValue,
        equityValue: result.equityValue,
        currentPrice,
        upsidePct: upside,
        impliedGrowth,
      },
    })
  }, [onDataChange, upperSymbol, assumptions, result, currentPrice, upside, impliedGrowth])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to value" icon={<Calculator size={18} />} />
  }

  if (ttmLoading && !seeded) return <WidgetSkeleton />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Calculator size={12} className="text-violet-400" />
          <span>Valuation Lab · DCF</span>
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">assumptions editable</span>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        {/* Headline result */}
        <div className="grid grid-cols-3 gap-2">
          <Result label="Intrinsic / share" value={result.intrinsicPerShare} />
          <Result label="Current price" value={currentPrice} />
          <Result
            label="Upside"
            value={upside}
            suffix="%"
            tone={upside === null ? undefined : upside >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>

        {result.warning && (
          <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
            {result.warning}
          </div>
        )}

        {impliedGrowth !== null && (
          <div className="mt-2 rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[10px] text-violet-200">
            Reverse DCF: at the current price the market is implying ~{(impliedGrowth * 100).toFixed(1)}% annual FCF growth.
          </div>
        )}

        {/* Editable assumptions */}
        <div className="mt-3 space-y-2">
          <NumberField label="Base FCF" value={baseFcf} step={1} onChange={setBaseFcf} hint={seededFcf !== null ? 'seeded from TTM' : 'enter manually'} />
          <PctField label="Stage-1 growth" value={growthRate} onChange={setGrowthRate} />
          <NumberField label="Forecast years" value={forecastYears} step={1} min={1} max={20} onChange={(v) => setForecastYears(Math.round(v))} />
          <PctField label="Discount rate (WACC)" value={discountRate} onChange={setDiscountRate} />
          <PctField label="Terminal growth" value={terminalGrowth} onChange={setTerminalGrowth} />
          <NumberField label="Net debt" value={netDebt} step={1} onChange={setNetDebt} />
          <NumberField label="Shares outstanding" value={shares} step={1} onChange={setShares} hint={shares <= 0 ? 'required for per-share' : undefined} />
        </div>

        {/* Sensitivity: intrinsic value across discount-rate shifts */}
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Sensitivity to discount rate
          </div>
          <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
            {[-0.02, -0.01, 0, 0.01, 0.02].map((delta) => {
              const r = runDcf({ ...assumptions, discountRate: discountRate + delta })
              return (
                <div key={delta} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-1 py-1">
                  <div className="text-[var(--text-muted)]">{((discountRate + delta) * 100).toFixed(0)}%</div>
                  <div className="font-semibold text-[var(--text-primary)]">
                    {r.intrinsicPerShare === null ? '—' : r.intrinsicPerShare.toFixed(1)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p className="mt-3 text-[9px] leading-3 text-[var(--text-muted)]">
          Educational model. Values are derived from your editable assumptions and VNIBB TTM data, not investment advice.
        </p>
      </div>

      <WidgetMeta className="px-1 pt-1" sourceLabel="TTM + user assumptions" align="right" />
    </div>
  )
}

function Result({
  label,
  value,
  suffix,
  tone,
}: {
  label: string
  value: number | null
  suffix?: string
  tone?: string
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`text-sm font-bold ${tone || 'text-[var(--text-primary)]'}`}>
        {value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}${suffix || ''}`}
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  hint?: string
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-[var(--text-secondary)]">
        {label}
        {hint && <span className="ml-1 text-[9px] text-[var(--text-muted)]">({hint})</span>}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-right text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
      />
    </label>
  )
}

function PctField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number((value * 100).toFixed(2))}
          step={0.5}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="w-20 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-right text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
        <span className="text-[var(--text-muted)]">%</span>
      </span>
    </label>
  )
}

export default ValuationLabWidget
