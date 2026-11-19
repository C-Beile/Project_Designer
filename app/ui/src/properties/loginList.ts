export interface LoginProperty {
  key: string
  value: string
}

export interface LoginEntry {
  name: string
  loginType: string
  title: string
  description: string
  properties: LoginProperty[]
}

export const LOGIN_TYPES = ['default', 'kerberos-server', 'ldapauth', 'usertoken', 'external', 'oauth2-clientcredentials', 'oauth2-authorizationcodeflow', 'oauth2-token']

export const LOGIN_PROPERTY_KEYS = [
  'krb5 realm',
  'krb5 kdc',
  'login module',
  'config',
  'ldap provider',
  'client auth',
  'auth method',
  'user key',
  'dn base',
  'user template',
  'auth header',
  'alias',
  'oauth2 login domain',
  'oauth2 user template',
  'www authentication params',
]

export const RESERVED_LOGIN_NAME = 'internal.default'

const text = (v: unknown) => (typeof v === 'string' ? v : '')

export function parseLoginList(json: string): LoginEntry[] {
  if (!json.trim()) return []
  try {
    const data: unknown = JSON.parse(json)
    if (!Array.isArray(data)) return []
    return data.map((raw: Record<string, unknown>) => ({
      name: text(raw.name),
      loginType: text(raw.loginType),
      title: text(raw.title),
      description: text(raw.description),
      properties: Array.isArray(raw.properties) ? raw.properties.map((p: Record<string, unknown>) => ({ key: text(p.key), value: text(p.value) })) : [],
    }))
  } catch {
    return []
  }
}

export function serializeLoginList(entries: LoginEntry[]): string {
  return entries.length === 0 ? '' : JSON.stringify(entries)
}

export function loginNames(entries: LoginEntry[]): string {
  return entries.map((e) => e.name).join(' | ')
}

export function propertiesSummary(properties: LoginProperty[]): string {
  return properties.length === 0 ? '' : `{${properties.map((p) => `${p.key}=${p.value}`).join(', ')}}`
}

export function emptyLogin(existing: LoginEntry[]): LoginEntry {
  const taken = new Set(existing.map((e) => e.name.toLowerCase()))
  let n = existing.length + 1
  while (taken.has(`login${n}`)) n++
  return { name: `login${n}`, loginType: LOGIN_TYPES[0], title: '', description: '', properties: [] }
}

export function validateLogins(entries: LoginEntry[]): string | null {
  const seen = new Set<string>()
  for (const e of entries) {
    const name = e.name.trim()
    if (!name) return 'Name must not be an empty String.'
    if (name.toLowerCase() === RESERVED_LOGIN_NAME) return `${RESERVED_LOGIN_NAME} is reserved for the default login.`
    if (seen.has(name.toLowerCase())) return `The name ${name} is used twice.`
    seen.add(name.toLowerCase())
    if (!e.loginType) return `${name} needs a type.`
  }
  return null
}

export function validateLoginProperties(properties: LoginProperty[]): string | null {
  const seen = new Set<string>()
  for (const p of properties) {
    if (!p.key.trim()) return 'Every property needs a key.'
    if (seen.has(p.key)) return `The key ${p.key} is used twice.`
    seen.add(p.key)
  }
  return null
}

export function trimLogins(entries: LoginEntry[]): LoginEntry[] {
  return entries.map((e) => ({ ...e, name: e.name.trim(), title: e.title.trim(), description: e.description.trim() }))
}
