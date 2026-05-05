'use client'

import { useMemo } from 'react'

import type { QuantPeriod } from '@/lib/api'
import { useHistoricalPrices, useMomentumProfile, useQuantMetrics } from '@/lib/queries'
import {
  buildQuantRegimeSummary,
  computeHurstFromPrices,
  quantPeriodToStartDate,
} from '@/lib/quantRegime'

interface ParkinsonMetric {
  current_regime?: string | null
  current_regime_z_score?: number | null
}

export function useQuantRegime(
  symbol: string,
  options?: {
    period?: QuantPeriod
    enabled?: boolean
  },
) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const period = options?.period || '1Y'
  const enabled = options?.enabled !== false && !!upperSymbol

  const momentumQuery = useMomentumProfile(upperSymbol, {
    period,
    enabled,
  })

  const volatilityQuery = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['parkinson_volatility'],
    enabled,
  })

  const historyQuery = useHistoricalPrices(upperSymbol, {
    startDate: quantPeriodToStartDate(period),
    adjustmentMode: 'adjusted',
    enabled,
  })

  const closes = useMemo(
    () =>
      ((historyQuery.data?.data || []) as Array<{ close?: number | string | null }>)
        .map((row) => Number(row.close))
        .filter(Number.isFinite),
    [historyQuery.data?.data],
  )

  const momentumPayload = momentumQuery.data?.data
  const volatilityMetric = volatilityQuery.data?.data?.metrics?.parkinson_volatility as ParkinsonMetric | undefined
  const hurst = useMemo(() => computeHurstFromPrices(closes), [closes])

  const summary = useMemo(
    () =>
      buildQuantRegimeSummary({
        hurst,
        volatilityRegime: volatilityMetric?.current_regime,
        volatilityZScore: volatilityMetric?.current_regime_z_score,
        momentumScore: momentumPayload?.momentum_score ?? null,
        momentumLabel: momentumPayload?.trend_label ?? null,
      }),
    [hurst, momentumPayload?.momentum_score, momentumPayload?.trend_label, volatilityMetric?.current_regime, volatilityMetric?.current_regime_z_score],
  )

  const hasData = Boolean(hurst !== null || momentumPayload || volatilityMetric)

  return {
    ...summary,
    hasData,
    isLoading: (momentumQuery.isLoading || volatilityQuery.isLoading || historyQuery.isLoading) && !hasData,
    isFetching: momentumQuery.isFetching || volatilityQuery.isFetching || historyQuery.isFetching,
    error: momentumQuery.error || volatilityQuery.error || historyQuery.error,
    refetch: async () => {
      await Promise.all([
        momentumQuery.refetch(),
        volatilityQuery.refetch(),
        historyQuery.refetch(),
      ])
    },
    updatedAt:
      volatilityQuery.data?.data?.last_data_date ||
      volatilityQuery.data?.data?.computed_at ||
      momentumPayload?.last_data_date ||
      momentumPayload?.computed_at ||
      historyQuery.dataUpdatedAt,
    momentumPayload,
    volatilityMetric,
  }
}

export default useQuantRegime
