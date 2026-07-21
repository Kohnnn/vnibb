import { focusManager, onlineManager } from '@tanstack/react-query'
import { describeIntradayUnavailable, getMarketState } from './marketHours'
import {
  getAdaptiveRefetchInterval,
  getVietnamMarketPhase,
} from './pollingPolicy'

const at = (time: string) => new Date(`2026-07-13T${time}:00+07:00`)

const polling = {
  marketOpenMs: 1_000,
  postCloseMs: 2_000,
  marketClosedMs: 3_000,
}

describe('Vietnam market sessions', () => {
  beforeEach(() => {
    onlineManager.setOnline(true)
    focusManager.setFocused(true)
  })


  it.each([
    ['08:59', 'pre-open', false],
    ['09:00', 'morning', true],
    ['11:29', 'morning', true],
    ['11:30', 'lunch', false],
    ['12:59', 'lunch', false],
    ['13:00', 'afternoon', true],
    ['14:44', 'afternoon', true],
    ['14:45', 'post-close-finalization', false],
    ['14:59', 'post-close-finalization', false],
    ['15:00', 'after-close', false],
  ] as const)('classifies %s ICT as %s', (time, phase, isOpen) => {
    const state = getMarketState(at(time))

    expect(state.phase).toBe(phase)
    expect(state.isOpen).toBe(isOpen)
  })

  it('classifies weekends as closed', () => {
    const saturday = new Date('2026-07-11T09:00:00+07:00')

    expect(getMarketState(saturday).phase).toBe('weekend')
    expect(getMarketState(saturday).isOpen).toBe(false)
    expect(getVietnamMarketPhase(saturday)).toBe('closed')
  })

  it.each([
    ['08:59', 3_000],
    ['09:00', 1_000],
    ['11:29', 1_000],
    ['11:30', 3_000],
    ['12:59', 3_000],
    ['13:00', 1_000],
    ['14:44', 1_000],
    ['14:45', 2_000],
    ['14:59', 2_000],
    ['15:00', 3_000],
  ] as const)('uses the expected polling interval at %s ICT', (time, interval) => {
    expect(getAdaptiveRefetchInterval(polling, at(time))).toBe(interval)
  })

  it('falls back to the closed interval when postCloseMs is omitted', () => {
    expect(getAdaptiveRefetchInterval({ marketOpenMs: 1_000, marketClosedMs: 3_000 }, at('14:45'))).toBe(3_000)
  })

  it('describes post-close finalization truthfully', () => {
    expect(describeIntradayUnavailable(getMarketState(at('14:45'))).primary).toContain('Post-close finalization')
  })
})
