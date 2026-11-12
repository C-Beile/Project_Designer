import type { RestResponseDto, WebserviceDto } from '../wire/types'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const REST_ROOT = '/services/rest'

export interface RestCall {
  id: string
  method: string
  path: string
  label: string
  record: boolean
}

export type KeyValue = { key: string; value: string; on: boolean }

export type LoginKind = 'none' | 'basic' | 'usertoken'

export function callsOf(ws: WebserviceDto): RestCall[] {
  const base = `${REST_ROOT}/${ws.name}`
  const allowed = new Set(ws.methods.map((m) => m.toUpperCase()))
  const out: RestCall[] = []
  if (allowed.has('GET')) out.push({ id: `${ws.name} GET list`, method: 'GET', path: base, label: 'List', record: false })
  if (allowed.has('POST')) out.push({ id: `${ws.name} POST`, method: 'POST', path: base, label: 'Create', record: false })
  if (allowed.has('GET')) out.push({ id: `${ws.name} GET one`, method: 'GET', path: `${base}/{id}`, label: 'Read one', record: true })
  if (allowed.has('PUT')) out.push({ id: `${ws.name} PUT`, method: 'PUT', path: `${base}/{id}`, label: 'Replace', record: true })
  if (allowed.has('PATCH')) out.push({ id: `${ws.name} PATCH`, method: 'PATCH', path: `${base}/{id}`, label: 'Update', record: true })
  if (allowed.has('DELETE')) out.push({ id: `${ws.name} DELETE`, method: 'DELETE', path: `${base}/{id}`, label: 'Delete', record: true })
  return out
}

export function loginKindOf(ws: WebserviceDto | null): LoginKind {
  const types = (ws?.loginTypes ?? []).map((t) => t.toLowerCase())
  if (types.length === 0) return 'basic'
  if (types.some((t) => t === 'internal.default' || t === 'login')) return 'basic'
  if (types.some((t) => t.includes('usertoken'))) return 'usertoken'
  if (types.every((t) => t === 'internal.none')) return 'none'
  return 'basic'
}

export function bodyTemplate(call: RestCall | null): string {
  if (!call) return ''
  if (call.method === 'POST') return '[\n  {\n    \n  }\n]'
  if (call.method === 'PUT' || call.method === 'PATCH') return '{\n  \n}'
  return ''
}

export function joinUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return b === '' ? p : `${b}${p}`
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function splitQuery(url: string): { path: string; params: KeyValue[] } {
  const at = url.indexOf('?')
  if (at < 0) return { path: url, params: [] }
  const params = url
    .slice(at + 1)
    .split('&')
    .filter((p) => p !== '')
    .map((p) => {
      const [k, ...v] = p.split('=')
      return { key: decode(k), value: decode(v.join('=')), on: true }
    })
  return { path: url.slice(0, at), params }
}

const SAFE_IN_QUERY = /[^A-Za-z0-9\-._~[\],]/g

function encodeQuery(s: string): string {
  return s.replace(SAFE_IN_QUERY, (c) => encodeURIComponent(c))
}

export function withQuery(path: string, params: KeyValue[]): string {
  const active = params.filter((p) => p.on && p.key.trim() !== '')
  if (active.length === 0) return path
  const q = active.map((p) => `${encodeQuery(p.key.trim())}=${encodeQuery(p.value)}`).join('&')
  return `${path}${path.includes('?') ? '&' : '?'}${q}`
}

export const PARAM_CHIPS: { key: string; value: string; hint: string }[] = [
  { key: 'count', value: '100', hint: 'How many records to return' },
  { key: 'startrow', value: '0', hint: 'First record to return (paging)' },
  { key: 'fields', value: '', hint: 'Only these fields, e.g. NAME,Consumer.FIELD' },
  { key: 'excludefields', value: '', hint: 'All fields except these' },
  { key: 'search', value: '', hint: 'Filter, Base64 encoded' },
  { key: 'applyRecordSorting', value: 'FULL', hint: 'FULL applies the sorting of the entity' },
  { key: 'entityParams[]', value: '', hint: 'Entity parameter: entityParams[Name_param]=Value' },
]

export type UrlPartKind = 'scheme' | 'host' | 'port' | 'punct' | 'path' | 'service' | 'variable' | 'id' | 'qkey' | 'qvalue'

export interface UrlPart {
  text: string
  kind: UrlPartKind
}

export function tokenizeUrl(url: string): UrlPart[] {
  const parts: UrlPart[] = []
  let rest = url
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*)(:\/\/)/.exec(rest)
  if (scheme) {
    parts.push({ text: scheme[1], kind: 'scheme' }, { text: scheme[2], kind: 'punct' })
    rest = rest.slice(scheme[0].length)
    const authority = /^[^/?#]*/.exec(rest)?.[0] ?? ''
    const colon = authority.lastIndexOf(':')
    if (colon > 0 && /^\d*$/.test(authority.slice(colon + 1))) {
      parts.push({ text: authority.slice(0, colon), kind: 'host' }, { text: ':', kind: 'punct' }, { text: authority.slice(colon + 1), kind: 'port' })
    } else if (authority !== '') {
      parts.push({ text: authority, kind: 'host' })
    }
    rest = rest.slice(authority.length)
  }
  const q = rest.indexOf('?')
  const pathText = q < 0 ? rest : rest.slice(0, q)
  const segments = pathText.split(/(\/)/)
  let afterRest = false
  let afterService = false
  for (const seg of segments) {
    if (seg === '') continue
    if (seg === '/') {
      parts.push({ text: seg, kind: 'punct' })
    } else if (/\{[^}]*\}/.test(seg) || /\{\{[^}]*\}\}/.test(seg)) {
      parts.push({ text: seg, kind: 'variable' })
    } else if (afterService) {
      parts.push({ text: seg, kind: 'id' })
    } else if (afterRest) {
      parts.push({ text: seg, kind: 'service' })
      afterService = true
    } else {
      parts.push({ text: seg, kind: 'path' })
      if (seg === 'rest') afterRest = true
    }
  }
  if (q >= 0) {
    parts.push({ text: '?', kind: 'punct' })
    const query = rest.slice(q + 1)
    for (const piece of query.split(/(&)/)) {
      if (piece === '') continue
      if (piece === '&') {
        parts.push({ text: '&', kind: 'punct' })
        continue
      }
      const eq = piece.indexOf('=')
      if (eq < 0) {
        parts.push({ text: piece, kind: 'qkey' })
      } else {
        parts.push({ text: piece.slice(0, eq), kind: 'qkey' }, { text: '=', kind: 'punct' }, { text: piece.slice(eq + 1), kind: 'qvalue' })
      }
    }
  }
  return parts
}

export type JsonKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'plain'

export interface JsonPart {
  text: string
  kind: JsonKind
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*"(?=\s*:))|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g

export function tokenizeJson(text: string): JsonPart[] {
  const parts: JsonPart[] = []
  let last = 0
  for (const m of text.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), kind: 'plain' })
    const kind: JsonKind = m[1] ? 'key' : m[2] ? 'string' : m[3] ? 'number' : m[4] ? 'bool' : m[5] ? 'null' : 'punct'
    parts.push({ text: m[0], kind })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: 'plain' })
  return parts
}

export function prettyBody(response: Pick<RestResponseDto, 'body' | 'headers'>): string {
  const type = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  if (/json/i.test(type) || /^\s*[{[]/.test(response.body)) {
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2)
    } catch {
      return response.body
    }
  }
  return response.body
}

export function statusClass(status: number): 'ok' | 'redirect' | 'client' | 'server' {
  if (status < 300) return 'ok'
  if (status < 400) return 'redirect'
  return status < 500 ? 'client' : 'server'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function defaultUser<T extends { title: string }>(users: T[]): T | null {
  return users.find((u) => /^ws/i.test(u.title) || /webservice/i.test(u.title)) ?? users[0] ?? null
}
