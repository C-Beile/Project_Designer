import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNotifications, getNotifications } from '../../../src/core/notifications'
import { useUpdateCheck } from '../../../src/shell/hooks/useUpdateCheck'
import { createMockForgeApi } from '../../support/mockApi'

describe('useUpdateCheck (Prüfung beim Start)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearNotifications()
  })
  afterEach(() => {
    vi.useRealTimers()
    clearNotifications()
  })

  it('meldet eine neuere Version mit zwei Aktionen', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, update: { version: '9.9.9', notes: null, date: null } })
    renderHook(() => useUpdateCheck(api, () => {}))
    await vi.advanceTimersByTimeAsync(5000)
    const found = getNotifications().filter((n) => n.text.includes('9.9.9'))
    expect(found).toHaveLength(1)
    expect(found[0].actions.map((a) => a.label)).toEqual(['Details', 'Install and restart'])
  })

  it('bleibt still, wenn es nichts Neues gibt', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, update: null })
    renderHook(() => useUpdateCheck(api, () => {}))
    await vi.advanceTimersByTimeAsync(5000)
    expect(getNotifications()).toHaveLength(0)
  })

  it('bleibt bei einem Fehler still (nur Protokoll)', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, updateError: 'kein Zugriff' })
    renderHook(() => useUpdateCheck(api, () => {}))
    await vi.advanceTimersByTimeAsync(5000)
    expect(getNotifications()).toHaveLength(0)
  })

  it('fragt nicht mehr, wenn das Fenster vorher zugeht', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, update: { version: '9.9.9', notes: null, date: null } })
    const { unmount } = renderHook(() => useUpdateCheck(api, () => {}))
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getNotifications()).toHaveLength(0)
  })
})
