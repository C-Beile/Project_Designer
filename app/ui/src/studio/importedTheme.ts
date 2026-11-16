import { EDITOR_KEYS, SYNTAX_KEYS, THEME_KEYS } from '../theme/themeSchema'
import { uiTokensFor } from '../theme/uiTheme'
import type { ImportedTheme } from '../theme/vscodeTheme'

export const IMPORTED_PREFIX = 'vscode:'

const COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function tomlString(value: string): string {
  return JSON.stringify(value)
}

/** Ein importiertes VS-Code-Theme als `.theme.toml`-Text, damit das Theme Studio es zeigen und als Kopie speichern kann. */
export function importedThemeToToml(theme: ImportedTheme): string {
  const { tokens, light } = uiTokensFor(theme.data)
  const sections = new Map<string, string[]>()
  const put = (key: string, value: string | undefined) => {
    if (!value || !COLOR.test(value)) return
    const at = key.lastIndexOf('.')
    const section = key.slice(0, at)
    const name = key.slice(at + 1)
    sections.set(section, [...(sections.get(section) ?? []), `${name} = ${tomlString(value)}`])
  }
  for (const k of THEME_KEYS) put(k.key, tokens[k.cssVar])
  for (const k of EDITOR_KEYS) put(k.key, theme.data.colors[k.monaco])
  for (const k of SYNTAX_KEYS) {
    const rule = theme.data.rules.find((r) => r.foreground && (r.token === k.token || r.token.startsWith(`${k.token}.`)))
    put(k.key, rule?.foreground ? `#${rule.foreground.replace(/^#/, '')}` : undefined)
  }
  const head = [
    '[theme]',
    `name = ${tomlString(theme.name)}`,
    `id = ${tomlString(IMPORTED_PREFIX + theme.id)}`,
    `kind = ${tomlString(light ? 'light' : 'dark')}`,
    'author = "Importiertes VS-Code-Theme"',
  ].join('\n')
  const body = [...sections.entries()].map(([section, lines]) => `[${section}]\n${lines.join('\n')}`)
  return [head, ...body].join('\n\n') + '\n'
}
