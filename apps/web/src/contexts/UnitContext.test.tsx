import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { getPublicUnitRuntimeConfig } from '@/lib/api'
import { convertFinancialValueForUnit } from '@/lib/units'
import { UnitProvider, useUnit } from './UnitContext'

jest.mock('@/lib/api', () => ({ getPublicUnitRuntimeConfig: jest.fn() }))

const wrapper = ({ children }: { children: ReactNode }) => <UnitProvider>{children}</UnitProvider>

const adminRuntime = {
  usd_vnd_default_rate: 28_000,
  usd_vnd_rates_by_year: { '2025': 30_000 },
}

beforeEach(() => {
  localStorage.clear()
  jest.mocked(getPublicUnitRuntimeConfig).mockResolvedValue(adminRuntime)
})

test('admin yearly rates supersede built-ins until an explicit local override is set', () => {
  const { result } = renderHook(() => useUnit(), { wrapper })
  act(() => result.current.applyAdminUsdRuntimeConfig(adminRuntime))
  expect(result.current.localUsdVndRatesByYear).toEqual({})
  act(() => result.current.setUnit('USD'))
  expect(convertFinancialValueForUnit(30_000_000, result.current.config, '2025')).toBe(1_000)
  expect(result.current.config.usdVndRatesByYear?.['2024']).toBe(25_000)

  act(() => result.current.setUsdVndRate(2025, 32_000))
  expect(convertFinancialValueForUnit(32_000_000, result.current.config, '2025')).toBe(1_000)
  act(() => result.current.setUsdVndRate(2025, null))
  expect(convertFinancialValueForUnit(30_000_000, result.current.config, '2025')).toBe(1_000)
})
test('preserves a previously saved explicit local rate over an admin rate', () => {
  localStorage.setItem('vnibb_unit_config', JSON.stringify({
    display: 'USD', decimalPlaces: 2, usdVndRatesByYear: { '2025': 32_000 },
  }))
  const { result } = renderHook(() => useUnit(), { wrapper })
  act(() => result.current.applyAdminUsdRuntimeConfig(adminRuntime))
  expect(result.current.localUsdVndRatesByYear).toEqual({ '2025': 32_000 })
  expect(convertFinancialValueForUnit(32_000_000, result.current.config, '2025')).toBe(1_000)
})

test.each(['null', 'false', '0', '""', '{'])('invalid stored config %s does not become local yearly overrides', (saved) => {
  localStorage.setItem('vnibb_unit_config', saved)
  const { result } = renderHook(() => useUnit(), { wrapper })
  act(() => result.current.applyAdminUsdRuntimeConfig(adminRuntime))
  expect(result.current.localUsdVndRatesByYear).toEqual({})
  expect(result.current.config.usdVndRatesByYear?.['2025']).toBe(30_000)
})

test.each(['null', 'false', '0', '""'])('a %s storage update does not make built-in rates local overrides', (saved) => {
  const { result } = renderHook(() => useUnit(), { wrapper })
  act(() => result.current.applyAdminUsdRuntimeConfig(adminRuntime))
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'vnibb_unit_config', newValue: saved })))
  expect(result.current.localUsdVndRatesByYear).toEqual({})
  expect(result.current.config.usdVndRatesByYear?.['2025']).toBe(30_000)
})
