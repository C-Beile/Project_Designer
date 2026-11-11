import { getWindowBackend, osWindowsAvailable } from '../windows/windowService'

// "Open File" from a window of its own (the Commit window): the main window opens the file in an editor tab. Inside the
// main window itself the request goes to the listeners directly; from another window it travels as an event.

const EVENT = 'forge://open-file'
const listeners = new Set<(path: string) => void>()

export function openFileInDesigner(path: string): void {
  if (osWindowsAvailable()) void getWindowBackend().emit(EVENT, { path }).catch(() => {})
  else listeners.forEach((l) => l(path))
}

/** The main window listens: here and for requests from other windows. Returns the unsubscribe function. */
export function subscribeOpenFile(listener: (path: string) => void): () => void {
  listeners.add(listener)
  let off: (() => void) | null = null
  let gone = false
  if (osWindowsAvailable()) {
    void getWindowBackend()
      .listen(EVENT, (payload) => {
        const path = (payload as { path?: unknown } | null)?.path
        if (typeof path === 'string') listener(path)
      })
      .then((unlisten) => {
        if (gone) unlisten()
        else off = unlisten
      })
      .catch(() => {})
  }
  return () => {
    gone = true
    listeners.delete(listener)
    off?.()
  }
}
