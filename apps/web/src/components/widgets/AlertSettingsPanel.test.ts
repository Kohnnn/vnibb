import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getAlertSettings, updateAlertSettings } from '@/lib/api'
import { AlertSettingsPanel, hasEffectiveBrowserNotifications } from './AlertSettingsPanel'

jest.mock('@/lib/api', () => ({ getAlertSettings: jest.fn(), updateAlertSettings: jest.fn() }))

describe('browser alert preferences', () => {
  test('reports delivery separately from the stored preference', () => {
    expect(hasEffectiveBrowserNotifications(true, 'granted')).toBe(true)
    expect(hasEffectiveBrowserNotifications(true, 'default')).toBe(false)
    expect(hasEffectiveBrowserNotifications(true, 'denied')).toBe(false)
    expect(hasEffectiveBrowserNotifications(true, 'unsupported')).toBe(false)
    expect(hasEffectiveBrowserNotifications(false, 'granted')).toBe(false)
  })

  test('does not treat the legacy server flag as consent or write local delivery settings to the API', async () => {
    window.localStorage.clear()
    const native = Object.assign(jest.fn(), { permission: 'granted', requestPermission: jest.fn() })
    const original = Object.getOwnPropertyDescriptor(window, 'Notification')
    Object.defineProperty(window, 'Notification', { configurable: true, value: native })
    const fixture = {
      user_id: 1, block_trade_threshold: 10, ownership_change_threshold: 5,
      enable_insider_buy_alerts: true, enable_insider_sell_alerts: false, enable_ownership_change_alerts: true,
      enable_browser_notifications: true, enable_email_notifications: true, enable_sound_alerts: true, notification_email: null,
    }
    jest.mocked(getAlertSettings).mockResolvedValue(fixture)
    jest.mocked(updateAlertSettings).mockResolvedValue({ ...fixture, ownership_change_threshold: 8 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    try {
      render(createElement(QueryClientProvider, { client }, createElement(AlertSettingsPanel)))
      expect(await screen.findByRole('button', { name: 'Enable desktop alerts' })).toBeEnabled()
      const threshold = screen.getByRole('spinbutton', { name: /Ownership Change Threshold/ })
      fireEvent.change(threshold, { target: { value: '8' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(updateAlertSettings).toHaveBeenCalledWith(1, {
        block_trade_threshold: 10, ownership_change_threshold: 8,
        enable_insider_buy_alerts: true, enable_insider_sell_alerts: false, enable_ownership_change_alerts: true,
      }))
      expect(native.requestPermission).not.toHaveBeenCalled()
      expect(native).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(window, 'Notification', original)
      else Reflect.deleteProperty(window, 'Notification')
    }
  })
})
