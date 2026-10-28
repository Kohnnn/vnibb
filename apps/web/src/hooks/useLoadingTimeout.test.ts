import { act, renderHook } from '@testing-library/react'
import { useLoadingTimeout } from './useLoadingTimeout'

describe('useLoadingTimeout', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('rearms the timeout when retrying a request that remains loading', () => {
    const { result } = renderHook(() => useLoadingTimeout(true, { timeoutMs: 1000 }))
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.timedOut).toBe(true)

    act(() => result.current.resetTimeout())
    expect(result.current.timedOut).toBe(false)
    act(() => jest.advanceTimersByTime(999))
    expect(result.current.timedOut).toBe(false)
    act(() => jest.advanceTimersByTime(1))
    expect(result.current.timedOut).toBe(true)
  })

  it('cancels the retry deadline when loading finishes', () => {
    const { result, rerender } = renderHook(({ loading }) => useLoadingTimeout(loading, { timeoutMs: 1000 }), { initialProps: { loading: true } })
    act(() => jest.advanceTimersByTime(1000))
    act(() => result.current.resetTimeout())
    rerender({ loading: false })
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.timedOut).toBe(false)
  })
})
