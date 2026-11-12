import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExternalChanges } from './useExternalChanges'
import { setWindowBackend, type WindowBackend } from '../../windows/windowService'
import type { ProjectChanged } from '../../wire/types'
import { createMockForgeApi } from '../../test/mockApi'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler>()

function fakeBackend(): WindowBackend {
  return {
    listen: async (event: string, h: Handler) => {
      handlers.set(event, h)
      return () => handlers.delete(event)
    },
  } as unknown as WindowBackend
}

const change = (over: Partial<ProjectChanged>): ProjectChanged => ({ project: 'C:/p', generation: 1, reason: 'watcher', changed: [], truncated: false, affected: [], modulesChanged: false, full: false, ownOnly: false, ...over })

function setup() {
  const api = createMockForgeApi({ projectTree: [], documents: {} })
  const spies = { reload: vi.fn(), scan: vi.fn(), status: vi.fn() }
  const verify = vi.spyOn(api, 'indexVerify')
  const external = vi.spyOn(api, 'externalChanges')
  const projectChanged = vi.fn()
  ;(api as unknown as Record<string, unknown>).projectChanged = projectChanged
  const view = renderHook(() =>
    useExternalChanges({
      api,
      tabState: { tabs: [], activeId: null },
      unsaved: new Set(),
      projects: ['C:/p'],
      detached: {},
      conflict: null,
      setConflict: () => {},
      markUnsaved: () => {},
      activateNodeRef: { current: undefined },
      editorWindowsRef: { current: null },
      setReloadToken: spies.reload,
      setScanTick: spies.scan,
      setSheetVersion: () => {},
      setStatus: spies.status,
    }),
  )
  return { api, spies, verify, external, projectChanged, view }
}

beforeEach(() => {
  handlers.clear()
  setWindowBackend(fakeBackend())
})
afterEach(() => {
  setWindowBackend(null)
  vi.useRealTimers()
})

describe('useExternalChanges', () => {
  it('a full change reloads everything and says why', async () => {
    const { spies } = setup()
    await act(async () => {})
    act(() => handlers.get('forge://project-changed')!(change({ full: true, reason: 'git' })))
    expect(spies.reload).toHaveBeenCalled()
    expect(spies.scan).toHaveBeenCalled()
    expect(spies.status).toHaveBeenCalledWith('Project reloaded (Git)')
  })

  it('own-only changes only refresh the problems', async () => {
    const { spies } = setup()
    await act(async () => {})
    act(() => handlers.get('forge://project-changed')!(change({ ownOnly: true, changed: [{ path: 'a', kind: 'added', own: true, objectType: 'entity', name: 'A' }] })))
    expect(spies.reload).not.toHaveBeenCalled()
    expect(spies.scan).toHaveBeenCalled()
  })

  it('a new object reloads the tree', async () => {
    const { spies } = setup()
    await act(async () => {})
    act(() => handlers.get('forge://project-changed')!(change({ changed: [{ path: 'a', kind: 'added', own: false, objectType: 'entity', name: 'A' }] })))
    expect(spies.reload).toHaveBeenCalled()
  })

  it('verifies on focus (debounced) and never polls', async () => {
    vi.useFakeTimers()
    const { verify, external, projectChanged } = setup()
    await act(async () => {})
    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(600)
    })
    expect(verify).toHaveBeenCalledTimes(1)
    verify.mockClear()
    external.mockClear()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(verify).not.toHaveBeenCalled()
    expect(external).not.toHaveBeenCalled()
    expect(projectChanged).not.toHaveBeenCalled()
  })
})
