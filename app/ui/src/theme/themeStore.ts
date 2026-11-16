import type { ForgeApi } from '../api/ForgeApi'
import { parseTheme, type ParsedTheme } from './themeToml'

export interface UserTheme {
  /** Dateiname, zum Beispiel `my-theme.theme.toml`. */
  file: string
  text: string
  /** `null`, wenn die Datei nicht lesbar ist; der Grund steht dann in `error`. */
  parsed: ParsedTheme | null
  error?: string
}

export const USER_THEME_PATH = ['appearance', 'userTheme'] as const

let themes: UserTheme[] = []
const listeners = new Set<() => void>()

export function parseUserTheme(file: string, text: string): UserTheme {
  try {
    return { file, text, parsed: parseTheme(text) }
  } catch (e) {
    return { file, text, parsed: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getUserThemes(): UserTheme[] {
  return themes
}

export function findUserTheme(file: string | undefined): UserTheme | undefined {
  return file ? themes.find((t) => t.file === file) : undefined
}

export function subscribeThemes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: UserTheme[]): void {
  themes = next
  listeners.forEach((l) => l())
}

/** Liest den Theme-Ordner des Nutzers neu ein. Fehler beim Lesen lassen die bisherige Liste stehen. */
export async function loadUserThemes(api: Pick<ForgeApi, 'userThemes'>): Promise<UserTheme[]> {
  const files = await api.userThemes()
  publish(files.map((f) => parseUserTheme(f.file, f.text)))
  return themes
}

/** Neu einlesen, sobald das Fenster den Fokus bekommt (Datei wurde außerhalb geändert). */
export function installThemeReload(api: Pick<ForgeApi, 'userThemes'>): () => void {
  const reload = () => void loadUserThemes(api).catch(() => {})
  window.addEventListener('focus', reload)
  return () => window.removeEventListener('focus', reload)
}

export function _resetThemeStoreForTests(): void {
  themes = []
  listeners.clear()
}
