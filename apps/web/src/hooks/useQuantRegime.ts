'use client'

import { useMemo } from 'react'

import type { QuantPeriod, QuantPriceDiagnostics } from '@/lib/api'
import { useHistoricalPrices, useMarketStructureTests, useMomentumProfile, useQuantMetrics } from '@/lib/queries'
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

  // Backend market-structure tests provide an authoritative R/S Hurst estimate.
  // Tolerates a not-yet-deployed backend (hook returns null on 404); we then
  // fall back to the client-side computation below.
  const structureQuery = useMarketStructureTests(upperSymbol, {
    period,
    enabled,
  })

  const historyQuery = useHistoricalPrices(upperSymbol, {
    startDate: quantPeriodToStartDate(period),
    adjustmentMode: 'adjusted',
    enabled,
  })

  const momentumQuality = momentumQuery.data?.meta as QuantPriceDiagnostics | undefined
  const volatilityQuality = volatilityQuery.data?.meta as QuantPriceDiagnostics | undefined
  const historyQuality = historyQuery.data?.meta
  const certifiedInputs = [momentumQuality, volatilityQuality, historyQuality].every((quality) =>
    ['confirmed_vnd', 'index_points', 'not_applicable'].includes(quality?.unit_status ?? ''))
  const historyUnit = historyQuality?.unit_status === 'confirmed_vnd' ? 'VND' : 'index_points'
  const certifiedHistory = Boolean(historyQuery.data?.data.length)
    && historyQuery.data!.data.every((row) => row.price_unit === historyUnit)
  const derivedWithheld = !certifiedInputs || !certifiedHistory
    || [momentumQuality, volatilityQuality].some((quality) => Boolean(quality?.unresolved_excluded_dates?.length))
    || Boolean(momentumQuery.data?.error || volatilityQuery.data?.error || historyQuery.data?.error)
  const structureQuality = structureQuery.data?.meta as QuantPriceDiagnostics | undefined
  const certifiedStructure = ['confirmed_vnd', 'index_points', 'not_applicable'].includes(structureQuality?.unit_status ?? '')
    && !structureQuality?.unresolved_excluded_dates?.length

  const closes = useMemo(
    () =>
      ((historyQuery.data?.data || []) as Array<{ close?: number | string | null }>)
        .map((row) => Number(row.close))
        .filter(Number.isFinite),
    [historyQuery.data?.data],
  )

  const momentumPayload = momentumQuery.data?.data
  const volatilityMetric = volatilityQuery.data?.data?.metrics?.parkinson_volatility as ParkinsonMetric | undefined
  const clientHurst = useMemo(() => computeHurstFromPrices(closes), [closes])
  const backendHurst = structureQuery.data?.data?.hurst_rs ?? null
  // Prefer the backend R/S Hurst when available; client estimate is the fallback.
  const hurst = derivedWithheld ? null : certifiedStructure && backendHurst !== null && Number.isFinite(backendHurst) ? backendHurst : clientHurst

  const summary = useMemo(
    () =>
      buildQuantRegimeSummary({
        hurst,
        volatilityRegime: derivedWithheld ? null : volatilityMetric?.current_regime,
        volatilityZScore: derivedWithheld ? null : volatilityMetric?.current_regime_z_score,
        momentumScore: derivedWithheld ? null : momentumPayload?.momentum_score ?? null,
        momentumLabel: derivedWithheld ? null : momentumPayload?.trend_label ?? null,
      }),
    [derivedWithheld, hurst, momentumPayload?.momentum_score, momentumPayload?.trend_label, volatilityMetric?.current_regime, volatilityMetric?.current_regime_z_score],
  )

  const hasData = !derivedWithheld && Boolean(hurst !== null || momentumPayload || volatilityMetric)

  return {
    ...summary,
    hasData,
    derivedWithheld,
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
      momentumPayload?.last_data_date ||
      null,
    fetchedAt:
      volatilityQuery.data?.data?.computed_at ||
      momentumPayload?.computed_at ||
      momentumQuery.dataUpdatedAt ||
      volatilityQuery.dataUpdatedAt ||
      historyQuery.dataUpdatedAt,
    momentumPayload,
    volatilityMetric,
  }
}

export default useQuantRegime
