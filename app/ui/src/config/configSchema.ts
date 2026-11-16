export type FieldRule =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'int'; min: number; max: number }
  | { type: 'bool' }
  | { type: 'string'; pattern?: RegExp; hint?: string }

export type Schema = Record<string, FieldRule & { optional?: boolean }>

export class ConfigError extends Error {
  constructor(file: string, key: string, problem: string) {
    super(`${file}: ${key} ${problem}`)
  }
}

function allowed(rule: FieldRule): string {
  switch (rule.type) {
    case 'enum':
      return rule.values.join(' | ')
    case 'int':
      return `Ganzzahl ${rule.min} bis ${rule.max}`
    case 'bool':
      return 'true | false'
    case 'string':
      return rule.hint ?? 'Text'
  }
}

/** Prüft einen Abschnitt gegen das Schema: unbekannte Schlüssel, fehlende Pflichtwerte, falsche Werte. Wirft `ConfigError`. */
export function checkSection(file: string, where: string, raw: unknown, schema: Schema): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(file, where, 'muss ein Abschnitt sein')
  const section = raw as Record<string, unknown>
  for (const key of Object.keys(section)) {
    if (!(key in schema)) throw new ConfigError(file, `${where}.${key}`, `ist unbekannt. Erlaubt: ${Object.keys(schema).join(', ')}`)
  }
  const out: Record<string, string | number | boolean> = {}
  for (const [key, rule] of Object.entries(schema)) {
    const value = section[key]
    const path = `${where}.${key}`
    if (value === undefined) {
      if (rule.optional) continue
      throw new ConfigError(file, path, `fehlt. Erlaubt: ${allowed(rule)}`)
    }
    const bad = () => new ConfigError(file, path, `hat den Wert ${JSON.stringify(value)}. Erlaubt: ${allowed(rule)}`)
    switch (rule.type) {
      case 'enum':
        if (typeof value !== 'string' || !rule.values.includes(value)) throw bad()
        break
      case 'int':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < rule.min || value > rule.max) throw bad()
        break
      case 'bool':
        if (typeof value !== 'boolean') throw bad()
        break
      case 'string':
        if (typeof value !== 'string' || value.trim() === '' || (rule.pattern && !rule.pattern.test(value))) throw bad()
        break
    }
    out[key] = value as string | number | boolean
  }
  return out
}
