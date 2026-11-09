import { useEffect, useRef } from 'react'
import { choiceDialog } from '../core/dialogService'
import { EVENTS } from './protocol'
import { getWindowBackend, osWindowsAvailable } from './windowService'

// Closing the main window (title bar, File > Exit) while documents have unsaved changes asks first,
// including documents that live in editor windows of their own. The close button of the main
// window only asks while there is something unsaved, so it can never get stuck.

export function useCloseGuard({
  unsavedCount,
  inWindows,
  saveAll,
}: {
  unsavedCount: number
  /** How many of the unsaved documents are open in windows of their own. */
  inWindows: number
  /** Saves everything; false when something could not be saved. */
  saveAll: () => Promise<boolean>
}) {
  const state = useRef({ unsavedCount, inWindows, saveAll })
  state.current = { unsavedCount, inWindows, saveAll }
  const asking = useRef(false)

  useEffect(() => {
    if (!osWindowsAvailable()) return
    void getWindowBackend().closeGuard('main', '', unsavedCount > 0).catch(() => {})
  }, [unsavedCount])

  useEffect(() => {
    if (!osWindowsAvailable()) return
    const backend = getWindowBackend()
    let stop: (() => void) | null = null
    let dead = false
    void backend
      .listen(EVENTS.closeRequested, (p) => {
        if ((p as { kind?: string }).kind !== 'main' || asking.current) return
        asking.current = true
        const { unsavedCount: n, inWindows: w } = state.current
        const where = w > 0 ? ` (${w} in separate ${w === 1 ? 'window' : 'windows'})` : ''
        void choiceDialog(
          `${n} ${n === 1 ? 'document has' : 'documents have'} unsaved changes${where}.`,
          [
            { id: 'save', label: 'Save All and Exit' },
            { id: 'discard', label: "Don't Save" },
            { id: 'cancel', label: 'Cancel' },
          ],
          'Exit',
        )
          .then(async (choice) => {
            if (choice === 'save') {
              if (await state.current.saveAll()) await backend.exitApp()
            } else if (choice === 'discard') {
              await backend.exitApp()
            }
          })
          .finally(() => {
            asking.current = false
          })
      })
      .then((u) => {
        if (dead) u()
        else stop = u
      })
    return () => {
      dead = true
      stop?.()
    }
  }, [])
}
