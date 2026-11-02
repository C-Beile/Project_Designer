// Shortcuts are written once as "Mod+Shift+S" and mean Ctrl on Windows/Linux and Cmd on macOS,
// so the menu model stays platform neutral (role brief: "Modifier-Abstraktion").

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac/i.test(navigator.platform || navigator.userAgent || '')
}

interface ParsedShortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parse(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase())
  return { mod: mods.includes('mod'), shift: mods.includes('shift'), alt: mods.includes('alt'), key }
}

export function formatShortcut(shortcut: string, mac = isMacPlatform()): string {
  const p = parse(shortcut)
  const key = p.key.length === 1 ? p.key.toUpperCase() : p.key.replace(/^Arrow/, '').replace(/^Page(Up|Down)$/, 'Page $1')
  if (mac) return `${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.mod ? '⌘' : ''}${key}`
  return [p.mod ? 'Ctrl' : null, p.alt ? 'Alt' : null, p.shift ? 'Shift' : null, key].filter(Boolean).join('+')
}

export function matchesShortcut(e: KeyboardEvent, shortcut: string, mac = isMacPlatform()): boolean {
  const p = parse(shortcut)
  const mod = mac ? e.metaKey : e.ctrlKey
  if (mod !== p.mod || e.shiftKey !== p.shift || e.altKey !== p.alt) return false
  if (e.key.toLowerCase() === p.key.toLowerCase()) return true
  // With Shift held, digit keys report their shifted character (layout dependent), so compare the physical key.
  return /^[0-9]$/.test(p.key) && e.code === `Digit${p.key}`
}
