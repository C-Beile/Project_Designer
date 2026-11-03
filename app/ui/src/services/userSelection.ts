import { useSyncExternalStore } from 'react'

// The user that is selected in the Users tab of a system. The Properties panel of the window shows
// that user's properties (as the original Designer does); the Users tab sets and clears the
// selection and reads the list again when a property was saved.

export interface UserSelection {
  systemKey: string
  systemName: string
  /** Name (id) of the user in the system database. */
  user: string
  /** Title of the user, for the panel header. */
  title: string
}

let selection: UserSelection | null = null
let changes = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setUserSelection(next: UserSelection | null): void {
  if (selection?.user === next?.user && selection?.systemKey === next?.systemKey && selection?.title === next?.title) return
  selection = next
  emit()
}

export function getUserSelection(): UserSelection | null {
  return selection
}

/** Called after a property of a user was written: the Users tab reads its list again. */
export function notifyUsersChanged(): void {
  changes += 1
  emit()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useUserSelection(): UserSelection | null {
  return useSyncExternalStore(subscribe, () => selection)
}

export function useUsersChanged(): number {
  return useSyncExternalStore(subscribe, () => changes)
}
