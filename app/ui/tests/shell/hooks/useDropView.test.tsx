import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearNotifications, getNotifications } from '../../../src/core/notifications'
import { useDropView } from '../../../src/shell/hooks/useDropView'

function dropEvent(type: 'dragover' | 'drop', files: File[], types = ['Files']) {
  const e = new Event(type, { cancelable: true }) as Event & { dataTransfer: unknown }
  e.dataTransfer = { types, files, dropEffect: 'none' }
  return e
}

describe('useDropView (Dateien ins Fenster ziehen)', () => {
  afterEach(() => clearNotifications())

  it('öffnet eine abgelegte Textdatei als Ansicht und verhindert das Browser-Verhalten', async () => {
    const open = vi.fn()
    renderHook(() => useDropView(open))
    const over = dropEvent('dragover', [])
    window.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    const drop = dropEvent('drop', [new File(['hallo'], 'a.txt')])
    window.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(open.mock.calls[0][0]).toMatchObject({ kind: 'view', label: 'a.txt', read_only: true })
  })

  it('meldet eine Datei, die nicht geöffnet werden kann, und öffnet keinen Reiter', async () => {
    const open = vi.fn()
    renderHook(() => useDropView(open))
    window.dispatchEvent(dropEvent('drop', [new File(['a\u0000b'], 'x.bin')]))
    await waitFor(() => expect(getNotifications().some((n) => n.text.includes('x.bin'))).toBe(true))
    expect(open).not.toHaveBeenCalled()
  })

  it('ignoriert Ziehen innerhalb der App (keine Dateien)', () => {
    const open = vi.fn()
    renderHook(() => useDropView(open))
    const e = dropEvent('drop', [], ['text/plain'])
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
