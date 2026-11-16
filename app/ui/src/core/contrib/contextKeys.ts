import { createStore } from '../store'

/** Erweiterbar per declaration merging: `declare module '.../contextKeys' { interface ContextKeys { 'git.repo': boolean } }`. */
export interface ContextKeys {
  hasProject: boolean
  dialogOpen: boolean
}

const keys = createStore<Partial<ContextKeys>>({})

export function setContextKey<K extends keyof ContextKeys>(key: K, value: ContextKeys[K]): void {
  if (keys.get()[key] === value) return
  keys.set({ ...keys.get(), [key]: value })
}

export function getContextKeys(): Partial<ContextKeys> {
  return keys.get()
}

export function useContextKeys(): Partial<ContextKeys> {
  return keys.use()
}

/** Bedingung über die Kontext-Schlüssel (für `when` von Tastenkürzeln und Beiträgen). */
export type When = (keys: Partial<ContextKeys>) => boolean

export function _resetContextKeysForTests(): void {
  keys.set({})
}
