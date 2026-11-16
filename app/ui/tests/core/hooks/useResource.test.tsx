import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { invalidateResources, useResource } from '../../../src/core/hooks/useResource'

describe('useResource', () => {
  it('loads once, keeps the value, and reports an error as text', async () => {
    const load = vi.fn().mockResolvedValue('A')
    const { result } = renderHook(() => useResource(load, []))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('A'))
    expect(load).toHaveBeenCalledTimes(1)
    const failing = renderHook(() => useResource(() => Promise.reject(new Error('boom')), []))
    await waitFor(() => expect(failing.result.current.error).toBe('boom'))
  })

  it('reloads when deps change and drops the answer of the stale request', async () => {
    let finishFirst: (v: string) => void = () => {}
    const load = vi.fn((signal: AbortSignal) => (load.mock.calls.length === 1 ? new Promise<string>((r) => (finishFirst = r)) : Promise.resolve(`second${signal.aborted ? '!' : ''}`)))
    const { result, rerender } = renderHook(({ id }) => useResource(load, [id]), { initialProps: { id: 1 } })
    rerender({ id: 2 })
    await waitFor(() => expect(result.current.data).toBe('second'))
    await act(async () => finishFirst('first'))
    expect(result.current.data).toBe('second')
  })

  it('reload() and a tag invalidation load again', async () => {
    const load = vi.fn().mockResolvedValue('x')
    const { result } = renderHook(() => useResource(load, [], ['project']))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    act(() => result.current.reload())
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    act(() => invalidateResources('project'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    act(() => invalidateResources('other'))
    expect(load).toHaveBeenCalledTimes(3)
  })
})
