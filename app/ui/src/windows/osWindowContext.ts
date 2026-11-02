import { createContext } from 'react'

// True inside a dialog that lives in an operating-system window of its own: `Modal` then fills the
// window (title bar, size and position belong to the window) instead of drawing a backdrop and a
// centred box.
export const OsWindowContext = createContext(false)
