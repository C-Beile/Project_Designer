const KEY = 'forge.workspaceFolder'
const LIST_KEY = 'forge.workspaceFolders'
const MAX_FOLDERS = 8

const listeners = new Set<() => void>()
let pending: string | null = null

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

export function getWorkspaceFolders(): string[] {
  try {
    const list = JSON.parse(read(LIST_KEY) ?? '[]') as unknown
    if (Array.isArray(list)) return list.filter((f): f is string => typeof f === 'string' && f !== '').slice(0, MAX_FOLDERS)
  } catch {
    return []
  }
  return []
}

export function getWorkspaceFolder(): string {
  return read(KEY) ?? getWorkspaceFolders()[0] ?? ''
}

export function setWorkspaceFolder(folder: string): void {
  write(KEY, folder)
  if (folder === '') return
  const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
  write(LIST_KEY, JSON.stringify([folder, ...getWorkspaceFolders().filter((f) => !same(f, folder))].slice(0, MAX_FOLDERS)))
  listeners.forEach((l) => l())
}

export function removeWorkspaceFolder(folder: string): void {
  const same = (a: string, b: string) => a.replace(/[\/]+$/, '').toLowerCase() === b.replace(/[\/]+$/, '').toLowerCase()
  write(LIST_KEY, JSON.stringify(getWorkspaceFolders().filter((f) => !same(f, folder))))
  if (same(read(KEY) ?? '', folder)) write(KEY, '')
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
