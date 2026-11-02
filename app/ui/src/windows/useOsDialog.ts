import { useEffect, useRef } from 'react'
import { notify } from '../shell/notifications'
import { openDialogWindow, osWindowsAvailable } from './windowService'

// A dialog of the main window that opens as an operating-system window of its own when windows are
// available (modal: the main window is locked while it is open). `active` switches on a request; the
// window opens once per request and `onFinished` runs when it is closed, whatever the result was.

export interface OsDialogSpec {
  name: string
  title: string
  size: { width: number; height: number }
  payload: unknown
  modal?: boolean
  resizable?: boolean
}

export function useOsDialog<T>(active: boolean, build: () => OsDialogSpec, onResult: (result: T | null) => void, onFinished: () => void) {
  const open = useRef(false)
  const latest = useRef({ build, onResult, onFinished })
  latest.current = { build, onResult, onFinished }
  useEffect(() => {
    if (!active || !osWindowsAvailable() || open.current) return
    open.current = true
    const spec = latest.current.build()
    void openDialogWindow<T>(spec.name, spec.title, spec.size, spec.payload, { modal: spec.modal ?? true, resizable: spec.resizable })
      .then((r) => latest.current.onResult(r))
      .catch((e) => notify(e instanceof Error ? e.message : String(e), { kind: 'error' }))
      .finally(() => {
        open.current = false
        latest.current.onFinished()
      })
  }, [active])
}
