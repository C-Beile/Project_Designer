import { tokenValue } from '../core/ui/gallery/themePreview'
import { EDITOR_KEYS, SYNTAX_KEYS } from '../theme/themeSchema'
import type { ParsedTheme } from '../theme/themeToml'
import { groupKeys } from './themeText'

export interface ColorField {
  /** Schlüssel in der Theme-Datei, zum Beispiel `surface.base` oder `editor.syntax.keyword`. */
  key: string
  description: string
  group: string
  /** Wert aus dem Theme; `undefined`, wenn das Theme den Schlüssel nicht setzt. */
  own: string | undefined
  /** Was gerade wirkt: der eigene Wert oder der geerbte. */
  effective: string
}

export type FieldKind = 'interface' | 'code'

/** Felder der Oberfläche, nach Kategorie. */
export function interfaceFields(parsed: ParsedTheme | null): ColorField[] {
  return groupKeys().flatMap((g) =>
    g.keys.map((k) => {
      const own = parsed?.tokens[k.cssVar]
      return { key: k.key, description: k.description, group: g.label, own, effective: own ?? tokenValue(k.cssVar) }
    }),
  )
}

/** Felder des Code-Editors: erst die Editor-Farben, dann die Farben der Code-Elemente. */
export function codeFields(parsed: ParsedTheme | null): ColorField[] {
  const kind = parsed?.meta.kind ?? 'dark'
  const editor = EDITOR_KEYS.map((k) => {
    const own = parsed?.editor.colors[k.monaco]
    return { key: k.key, description: k.description, group: 'Editor', own, effective: own ?? k.fallback[kind] }
  })
  const syntax = SYNTAX_KEYS.map((k) => {
    const own = parsed?.editor.syntax[k.token]?.color
    return { key: k.key, description: k.description, group: 'Syntax', own, effective: own ?? k.fallback[kind] }
  })
  return [...editor, ...syntax]
}

export function fieldsFor(kind: FieldKind, parsed: ParsedTheme | null): ColorField[] {
  return kind === 'code' ? codeFields(parsed) : interfaceFields(parsed)
}

export function groupFields(fields: ColorField[]): { group: string; fields: ColorField[] }[] {
  const groups: { group: string; fields: ColorField[] }[] = []
  for (const f of fields) {
    let g = groups.find((x) => x.group === f.group)
    if (!g) groups.push((g = { group: f.group, fields: [] }))
    g.fields.push(f)
  }
  return groups
}
