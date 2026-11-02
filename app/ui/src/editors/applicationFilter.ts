import { useSyncExternalStore } from 'react'

// Object types offered in the list of the application editor. The Navigator of the application
// object shows the check boxes (original Designer, shot 49); the editor reads them from here.
// Process and Report are listed there as in the original, but their node kinds are not documented,
// so they cannot be added to the menu yet.

export interface ApplicationFilter {
  NeonContext: boolean
  NeonDashboard: boolean
  Role: boolean
  /** Listed for orientation only: their node kind in the menu is not documented, so they cannot be dragged. */
  Process: boolean
  Report: boolean
  Entity: boolean
  /** Sub filter of Process: only processes of the tree group `executables` (variant EXECUTABLE). */
  ExecutablesOnly: boolean
}

let current: ApplicationFilter = { NeonContext: true, NeonDashboard: true, Role: true, Process: false, Report: false, Entity: false, ExecutablesOnly: false }
const listeners = new Set<() => void>()

export function getApplicationFilter(): ApplicationFilter {
  return current
}

export function setApplicationFilter(key: keyof ApplicationFilter, value: boolean): void {
  current = { ...current, [key]: value }
  listeners.forEach((l) => l())
}

export function useApplicationFilter(): ApplicationFilter {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
