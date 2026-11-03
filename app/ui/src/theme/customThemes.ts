import type { ImportedTheme } from './vscodeTheme'

// Colour themes the user imported (VS Code themes), kept per user in localStorage. A storage problem
// only means the list is empty after a restart. The list is held in memory so the same theme object
// is handed out until something changes; the editor theme code relies on that.

export const CUSTOM_THEMES_KEY = 'forge.customThemes.v1'
const MAX_THEMES = 30

function load(): ImportedTheme[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEMES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ImportedTheme[]).filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.data && typeof t.data === 'object') : []
  } catch {
    return []
  }
}

let list: ImportedTheme[] = load()
const listeners = new Set<() => void>()

function persist(next: ImportedTheme[]): void {
  list = next
  try {
    window.localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(next))
  } catch {
    // the theme stays available for this session
  }
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
