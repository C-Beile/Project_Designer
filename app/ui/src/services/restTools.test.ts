import { describe, expect, it } from 'vitest'
import { bodyTemplate, callsOf, joinUrl, loginKindOf, splitQuery, tokenizeJson, tokenizeUrl, withQuery } from './restTools'

const ws = (methods: string[], loginTypes: string[] = []) => ({ name: 'Person_ws', module: null, methods, loginTypes, fields: 0 })

describe('callsOf', () => {
  it('offers only the methods the web service allows', () => {
    expect(callsOf(ws(['PATCH'])).map((c) => c.method)).toEqual(['PATCH'])
    expect(callsOf(ws(['GET', 'POST'])).map((c) => `${c.method} ${c.record ? 'one' : 'all'}`)).toEqual(['GET all', 'POST all', 'GET one'])
    expect(callsOf(ws([]))).toEqual([])
  })

  it('addresses a record by id', () => {
    expect(callsOf(ws(['DELETE']))[0].path).toBe('/services/rest/Person_ws/{id}')
  })
})

describe('loginKindOf', () => {
  it('follows the login type of the web service', () => {
    expect(loginKindOf(ws([], ['internal.default']))).toBe('basic')
    expect(loginKindOf(ws([], ['internal.none']))).toBe('none')
    expect(loginKindOf(ws([], ['usertoken']))).toBe('usertoken')
    expect(loginKindOf(null)).toBe('basic')
  })
})

describe('urls', () => {
  it('joins base and path with exactly one slash', () => {
    expect(joinUrl('https://h:8443/', '/services/rest/X')).toBe('https://h:8443/services/rest/X')
    expect(joinUrl('', 'a')).toBe('/a')
  })

  it('round-trips the query', () => {
    const split = splitQuery('/services/rest/X?count=10&entityParams[A_param]=a b')
    expect(split.path).toBe('/services/rest/X')
    expect(split.params.map((p) => [p.key, p.value])).toEqual([['count', '10'], ['entityParams[A_param]', 'a b']])
    expect(withQuery(split.path, split.params)).toBe('/services/rest/X?count=10&entityParams[A_param]=a%20b')
  })

  it('colours scheme, host, port, service, id, variable and query', () => {
    const kinds = tokenizeUrl('https://h:8443/services/rest/Person_ws/{id}?count=5').filter((p) => p.kind !== 'punct').map((p) => `${p.kind}:${p.text}`)
    expect(kinds).toEqual(['scheme:https', 'host:h', 'port:8443', 'path:services', 'path:rest', 'service:Person_ws', 'variable:{id}', 'qkey:count', 'qvalue:5'])
  })

  it('keeps every character of the url when colouring', () => {
    const url = 'http://localhost:8080/services/rest/A/42?fields=X,Y&startrow=0'
    expect(tokenizeUrl(url).map((p) => p.text).join('')).toBe(url)
  })
})

describe('json', () => {
  it('colours keys, strings, numbers, booleans and null and loses nothing', () => {
    const text = '{\n  "a": "x",\n  "b": 1.5,\n  "c": [true, null]\n}'
    const parts = tokenizeJson(text)
    expect(parts.map((p) => p.text).join('')).toBe(text)
    expect(parts.filter((p) => p.kind === 'key').map((p) => p.text)).toEqual(['"a"', '"b"', '"c"'])
    expect(parts.find((p) => p.kind === 'number')?.text).toBe('1.5')
    expect(parts.find((p) => p.kind === 'bool')?.text).toBe('true')
    expect(parts.find((p) => p.kind === 'null')?.text).toBe('null')
  })

  it('starts a body for the creating methods', () => {
    expect(bodyTemplate({ id: '', method: 'POST', path: '', label: '', record: false })).toContain('[')
    expect(bodyTemplate({ id: '', method: 'GET', path: '', label: '', record: false })).toBe('')
  })
})

describe('joinUrl with a server that already ends with the REST root', () => {
  it('does not repeat /services/rest', () => {
    expect(joinUrl('https://h.cloud/services/rest', '/services/rest/Product_ws')).toBe('https://h.cloud/services/rest/Product_ws')
    expect(joinUrl('https://h.cloud', '/services/rest/Product_ws')).toBe('https://h.cloud/services/rest/Product_ws')
  })
})
