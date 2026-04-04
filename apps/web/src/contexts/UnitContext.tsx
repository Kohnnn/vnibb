'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  DEFAULT_UNIT_CONFIG,
  normalizeUnitConfig,
  type UnitConfig,
  type UnitDisplay
} from '@/lib/units'
import { getPublicUnitRuntimeConfig } from '@/lib/api'

const STORAGE_KEY = 'vnibb_unit_config'

interface UnitContextValue {
  config: UnitConfig
  globalUsdVndDefaultRate: number
  localUsdVndRatesByYear: Record<string, number>
  setUnit: (display: UnitDisplay) => void
  setDecimalPlaces: (places: number) => void
  setUsdVndRate: (year: number, rate: number | null) => void
  clearUsdVndRates: () => void
}

const UnitContext = createContext<UnitContextValue | null>(null)

function clampDecimals(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_UNIT_CONFIG.decimalPlaces
  return Math.max(0, Math.min(3, Math.round(value)))
}

export function UnitProvider({ children }: { children: ReactNode }) {
  const [localConfig, setLocalConfig] = useState<UnitConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_UNIT_CONFIG
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return DEFAULT_UNIT_CONFIG
      return normalizeUnitConfig(JSON.parse(saved) as Partial<UnitConfig>)
    } catch {
      return DEFAULT_UNIT_CONFIG
    }
  })
  const [globalUsdVndDefaultRate, setGlobalUsdVndDefaultRate] = useState(
    DEFAULT_UNIT_CONFIG.usdVndDefaultRate || 25_000
  )

  const config = useMemo(() => {
    const normalized = normalizeUnitConfig(localConfig)
    return {
      ...normalized,
      currency: normalized.display === 'USD' ? 'USD' : 'VND',
      usdVndDefaultRate: globalUsdVndDefaultRate,
    }
  }, [globalUsdVndDefaultRate, localConfig])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(localConfig))
    } catch (error) {
      console.error('Failed to save unit config:', error)
    }
  }, [localConfig])

  useEffect(() => {
    let active = true

    if (typeof fetch !== 'function') {
      return () => {
        active = false
      }
    }

    const loadGlobalDefaults = async () => {
      try {
        const runtime = await getPublicUnitRuntimeConfig()
        if (!active) return
        if (Number.isFinite(runtime.usd_vnd_default_rate) && runtime.usd_vnd_default_rate > 0) {
          setGlobalUsdVndDefaultRate(runtime.usd_vnd_default_rate)
        }
      } catch {
        // Keep local defaults if the public runtime endpoint is unavailable.
      }
    }

    void loadGlobalDefaults()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const next = normalizeUnitConfig(JSON.parse(event.newValue) as Partial<UnitConfig>)
        setLocalConfig(next)
      } catch {
        // Ignore malformed storage updates
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setUnit = useCallback((display: UnitDisplay) => {
    setLocalConfig((prev) => ({
      ...prev,
      display,
      currency: display === 'USD' ? 'USD' : 'VND',
    }))
  }, [])

  const setDecimalPlaces = useCallback((places: number) => {
    const next = clampDecimals(places)
    setLocalConfig((prev) => ({ ...prev, decimalPlaces: next }))
  }, [])

  const setUsdVndRate = useCallback((year: number, rate: number | null) => {
    const normalizedYear = String(Math.trunc(year))
    setLocalConfig((prev) => {
      const nextRates = { ...(prev.usdVndRatesByYear || {}) }
      if (rate === null || !Number.isFinite(rate) || rate <= 0) {
        delete nextRates[normalizedYear]
      } else {
        nextRates[normalizedYear] = Number(rate)
      }
      return {
        ...prev,
        usdVndRatesByYear: nextRates,
      }
    })
  }, [])

  const clearUsdVndRates = useCallback(() => {
    setLocalConfig((prev) => ({
      ...prev,
      usdVndRatesByYear: {},
    }))
  }, [])

  const value = useMemo(
    () => ({
      config,
      globalUsdVndDefaultRate,
      localUsdVndRatesByYear: localConfig.usdVndRatesByYear || {},
      setUnit,
      setDecimalPlaces,
      setUsdVndRate,
      clearUsdVndRates,
    }),
    [clearUsdVndRates, config, globalUsdVndDefaultRate, localConfig.usdVndRatesByYear, setDecimalPlaces, setUnit, setUsdVndRate]
  )

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>
}

export function useUnit() {
  const context = useContext(UnitContext)
  if (!context) {
    throw new Error('useUnit must be used within a UnitProvider')
  }
  return context
}
