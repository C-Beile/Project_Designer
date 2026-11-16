import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(next: T): void
  update(change: (current: T) => T): void
  subscribe(listener: () => void): () => void
  /** Hook: liest den Wert und rendert bei jeder Änderung neu. */
  use(): T
}

/** Kleiner Store für Zustand außerhalb von React (ersetzt handgebaute Listener-Sets). */
export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const get = () => value
  const set = (next: T) => {
    if (Object.is(next, value)) return
    value = next
    for (const listener of [...listeners]) listener()
  }
  return {
    get,
    set,
    update: (change) => set(change(value)),
    subscribe,
    use: () => useSyncExternalStore(subscribe, get),
  }
}
