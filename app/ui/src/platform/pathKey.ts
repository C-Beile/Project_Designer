// One place that decides when two file paths mean the same file. Separators are unified and a
// trailing slash is ignored everywhere. Letter case is ignored on Windows (case-insensitive file
// system) but kept on macOS and Linux, where "Project" and "project" can be two different folders.

export function isCaseSensitivePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|linux/i.test(navigator.platform || '')
}

export function pathKey(path: string): string {
  const unified = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return isCaseSensitivePlatform() ? unified : unified.toLowerCase()
}
