import { configGet, configSet, onConfigChange, touches } from '../settings/appConfig'
import type { ImportedTheme } from './vscodeTheme'

// Colour themes the user imported (VS Code themes), kept per user in designer.conf
// ([appearance] custom_themes). The list is held in memory so the same theme object
// is handed out until something changes; the editor theme code relies on that.

const THEMES_PATH = ['appearance', 'custom_themes'] as const
const MAX_THEMES = 30

function load(): ImportedTheme[] {
  const parsed = configGet<unknown>(...THEMES_PATH)
  return Array.isArray(parsed) ? (parsed as ImportedTheme[]).filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.data && typeof t.data === 'object') : []
}

let list: ImportedTheme[] = load()
const listeners = new Set<() => void>()

function persist(next: ImportedTheme[]): void {
  list = next
  configSet(THEMES_PATH, next)
  listeners.forEach((l) => l())
}

export function customThemes(): ImportedTheme[] {
  return list
}

export function findCustomTheme(id: string): ImportedTheme | undefined {
  return list.find((t) => t.id === id)
}

/** Adds a theme; a theme with the same id (same name) is replaced. */
export function saveCustomTheme(theme: ImportedTheme): void {
  persist([...list.filter((t) => t.id !== theme.id), theme].slice(-MAX_THEMES))
}

export function removeCustomTheme(id: string): void {
  persist(list.filter((t) => t.id !== id))
}

export function reloadCustomThemes(): void {
  list = load()
  listeners.forEach((l) => l())
}

export function subscribeCustomThemes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Beim Laden der Konfiguration und bei Änderungen aus einem anderen Fenster neu lesen.
onConfigChange((path) => {
  if (touches(path, THEMES_PATH)) {
    list = load()
    listeners.forEach((l) => l())
  }
})
