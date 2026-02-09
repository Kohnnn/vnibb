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

const STORAGE_KEY = 'vnibb_unit_config'

interface UnitContextValue {
  config: UnitConfig
  setUnit: (display: UnitDisplay) => void
  setDecimalPlaces: (places: number) => void
}

const UnitContext = createContext<UnitContextValue | null>(null)

function clampDecimals(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_UNIT_CONFIG.decimalPlaces
  return Math.max(0, Math.min(3, Math.round(value)))
}

export function UnitProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<UnitConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_UNIT_CONFIG
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return DEFAULT_UNIT_CONFIG
      return normalizeUnitConfig(JSON.parse(saved) as Partial<UnitConfig>)
    } catch {
      return DEFAULT_UNIT_CONFIG
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch (error) {
      console.error('Failed to save unit config:', error)
    }
  }, [config])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const next = normalizeUnitConfig(JSON.parse(event.newValue) as Partial<UnitConfig>)
        setConfig(next)
      } catch {
        // Ignore malformed storage updates
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setUnit = useCallback((display: UnitDisplay) => {
    setConfig((prev) => ({ ...prev, display }))
  }, [])

  const setDecimalPlaces = useCallback((places: number) => {
    const next = clampDecimals(places)
    setConfig((prev) => ({ ...prev, decimalPlaces: next }))
  }, [])

  const value = useMemo(
    () => ({ config, setUnit, setDecimalPlaces }),
    [config, setUnit, setDecimalPlaces]
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
