import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from './store'

describe('createStore', () => {
  it('notifies listeners only when the value changes and stops after unsubscribe', () => {
    const store = createStore(1)
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set(1)
    store.update((n) => n + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.set(5)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('use() re-renders a component with the new value', () => {
    const store = createStore('a')
    const { result } = renderHook(() => store.use())
    expect(result.current).toBe('a')
    act(() => store.set('b'))
    expect(result.current).toBe('b')
  })
})
