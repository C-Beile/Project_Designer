import { THEME_KEYS, type ThemeKey } from '../theme/themeSchema'

export const THEME_FILE_SUFFIX = '.theme.toml'

const ESCAPE = /[.*+?^${}()|[\]\\]/g
const escapeRegExp = (s: string) => s.replace(ESCAPE, '\\$&')

function splitKey(key: string): { section: string; name: string } {
  const at = key.lastIndexOf('.')
  return { section: key.slice(0, at), name: key.slice(at + 1) }
}

/** Setzt `kategorie.name = "wert"` im Text und lässt Kommentare und Reihenfolge stehen. Fehlt der Schlüssel, wird er ergänzt. */
export function setKeyInText(text: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const { section, name } = splitKey(key)
  const header = new RegExp(`^\\s*\\[${escapeRegExp(section)}\\]\\s*(#.*)?$`)
  const start = lines.findIndex((l) => header.test(l))
  const line = (indent = '') => `${indent}${name} = "${value}"`

  if (start < 0) {
    const tail = lines.length > 0 && lines[lines.length - 1].trim() === '' ? [] : ['']
    return [...lines, ...tail, `[${section}]`, line(), ''].join(eol).replace(/\r?\n\r?\n$/, eol)
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i
      break
    }
  }
  const keyLine = new RegExp(`^(\\s*${escapeRegExp(name)}\\s*=\\s*)("[^"]*"|'[^']*')(.*)$`)
  for (let i = start + 1; i < end; i++) {
    const m = keyLine.exec(lines[i])
    if (m) {
      lines[i] = `${m[1]}"${value}"${m[3]}`
      return lines.join(eol)
    }
  }
  let last = end - 1
  while (last > start && lines[last].trim() === '') last--
  lines.splice(last + 1, 0, line())
  return lines.join(eol)
}

/** Datei-Name aus einem Anzeigenamen: kleine Buchstaben, Ziffern und `-`. `null`, wenn nichts übrig bleibt. */
export function themeFileName(displayName: string): string | null {
  const stem = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return stem ? `${stem}${THEME_FILE_SUFFIX}` : null
}

/** Gleiche Datei mit neuem Namen, Id und Art. */
export function retitleTheme(text: string, name: string, file: string, kind: 'dark' | 'light'): string {
  const id = file.slice(0, -THEME_FILE_SUFFIX.length)
  let out = setKeyInText(text, 'theme.name', name.replace(/["\\]/g, ''))
  out = setKeyInText(out, 'theme.id', id)
  out = setKeyInText(out, 'theme.kind', kind)
  return out.replace(/^(\s*author\s*=\s*)"[^"]*"/m, '$1""')
}

export interface KeyGroup {
  category: string
  keys: ThemeKey[]
}

const CATEGORY_LABELS: Record<string, string> = {
  surface: 'Surfaces',
  text: 'Text',
  border: 'Borders',
  accent: 'Accents',
  state: 'States',
  selection: 'Selection',
  button: 'Buttons',
}

/** Die Theme-Schlüssel nach Kategorie, in der Reihenfolge des Schemas. */
export function groupKeys(keys: ThemeKey[] = THEME_KEYS): (KeyGroup & { label: string })[] {
  const groups: (KeyGroup & { label: string })[] = []
  for (const key of keys) {
    const category = key.key.split('.')[0]
    let group = groups.find((g) => g.category === category)
    if (!group) groups.push((group = { category, label: CATEGORY_LABELS[category] ?? category, keys: [] }))
    group.keys.push(key)
  }
  return groups
}

/** `<input type="color">` kennt nur `#rrggbb`. */
export function toColorInput(value: string): string {
  const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim())
  if (!m) return '#000000'
  let hex = m[1]
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('')
  return `#${hex.slice(0, 6).toLowerCase()}`
}
