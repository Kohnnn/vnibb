import { hasEffectiveBrowserNotifications } from './AlertSettingsPanel'

describe('browser alert preferences', () => {
  test('reports delivery separately from the stored preference', () => {
    expect(hasEffectiveBrowserNotifications(true, 'granted')).toBe(true)
    expect(hasEffectiveBrowserNotifications(true, 'default')).toBe(false)
    expect(hasEffectiveBrowserNotifications(true, 'denied')).toBe(false)
    expect(hasEffectiveBrowserNotifications(true, 'unsupported')).toBe(false)
    expect(hasEffectiveBrowserNotifications(false, 'granted')).toBe(false)
  })
})
