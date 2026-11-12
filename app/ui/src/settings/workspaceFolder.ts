import { configGet, configSet, onConfigChange, slash, touches } from './appConfig'

// Der Ordner, in dem "Open Projects from Folder" sucht, und die zuletzt benutzten Ordner.
// Abschnitt [workspace] in designer.conf: `folder` und `recent`. Ordner stehen immer mit / in der Datei.

const FOLDER_PATH = ['workspace', 'folder'] as const
const RECENT_PATH = ['workspace', 'recent'] as const
const MAX_FOLDERS = 8

const listeners = new Set<() => void>()
let pending: string | null = null

// Auch Änderungen aus einem anderen Fenster erreichen die Anzeige.
onConfigChange((path) => {
  if (touches(path, ['workspace'])) listeners.forEach((l) => l())
})

const trimSlash = (p: string) => p.replace(/\/+$/, '').toLowerCase()
const same = (a: string, b: string) => trimSlash(slash(a)) === trimSlash(slash(b))

export function getWorkspaceFolders(): string[] {
  const list = configGet<unknown>(...RECENT_PATH)
  return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string' && f !== '').slice(0, MAX_FOLDERS) : []
}

export function getWorkspaceFolder(): string {
  return configGet<string>(...FOLDER_PATH) ?? getWorkspaceFolders()[0] ?? ''
}

export function setWorkspaceFolder(folder: string): void {
  configSet(FOLDER_PATH, folder === '' ? undefined : folder)
  if (folder === '') return
  configSet(RECENT_PATH, [folder, ...getWorkspaceFolders().filter((f) => !same(f, folder))].slice(0, MAX_FOLDERS))
  listeners.forEach((l) => l())
}

export function removeWorkspaceFolder(folder: string): void {
  configSet(RECENT_PATH, getWorkspaceFolders().filter((f) => !same(f, folder)))
  if (same(configGet<string>(...FOLDER_PATH) ?? '', folder)) configSet(FOLDER_PATH, undefined)
  listeners.forEach((l) => l())
}

export function subscribeWorkspaceFolders(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function chooseWorkspaceFolder(folder: string | null): void {
  pending = folder
}

export function takePendingWorkspaceFolder(): string | null {
  const folder = pending
  pending = null
  return folder
}
