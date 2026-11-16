import { matchesShortcut } from '../shortcuts'
import { createStore } from '../store'
import { isPluginAvailable } from '../plugins/registry'
import { getContextKeys, type When } from './contextKeys'

export interface KeybindingSpec {
  /** Id eines Befehls aus `registerCommand`. */
  command: string
  /** Kürzel in der Schreibweise von `shortcuts.ts`, z. B. `Mod+Shift+T`. */
  key: string
  when?: When
  plugin?: string
}

const bindings = createStore<KeybindingSpec[]>([])

export function registerKeybinding(spec: KeybindingSpec): () => void {
  bindings.update((list) => [...list, spec])
  return () => bindings.update((list) => list.filter((b) => b !== spec))
}

export function getKeybindings(): KeybindingSpec[] {
  return bindings.get()
}

/** Der Befehl, den diese Taste auslöst (erste passende Bindung, deren Plugin und Bedingung gelten). */
export function commandForKey(e: KeyboardEvent): KeybindingSpec | undefined {
  const keys = getContextKeys()
  return bindings.get().find((b) => (b.plugin === undefined || isPluginAvailable(b.plugin)) && (b.when?.(keys) ?? true) && matchesShortcut(e, b.key))
}

export function _resetKeybindingsForTests(): void {
  bindings.set([])
}
