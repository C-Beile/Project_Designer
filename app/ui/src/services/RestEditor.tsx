import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { RestResponseDto, RestServerDto, RestUserDto, WebserviceDto } from '../wire/types'
import { errorText } from '../core/errorText'
import { logOutput } from '../core/outputBus'
import {
  METHODS,
  REST_ROOT,
  PARAM_CHIPS,
  bodyTemplate,
  callsOf,
  defaultUser,
  formatSize,
  joinUrl,
  loginKindOf,
  prettyBody,
  splitQuery,
  statusClass,
  tokenizeJson,
  tokenizeUrl,
  withQuery,
  type KeyValue,
  type LoginKind,
  type RestCall,
} from './restTools'

const BASE_KEY = 'forge.rest.base'
const BASES_KEY = 'forge.rest.bases'
const USER_KEY = 'forge.rest.user'
const INSECURE_KEY = 'forge.rest.insecure'
const BODY_METHODS = ['POST', 'PUT', 'PATCH']
const MAX_HIGHLIGHT = 200_000

function read(key: string, fallback = ''): string {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

function readList(key: string): string[] {
  try {
    const list = JSON.parse(read(key, '[]')) as unknown
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

function HighlightedUrl({ value, onChange, onEnter, label }: { value: string; onChange: (v: string) => void; onEnter: () => void; label: string }) {
  const overlay = useRef<HTMLPreElement | null>(null)
  const parts = useMemo(() => tokenizeUrl(value), [value])
  return (
    <div className="rest-url-wrap">
      <pre ref={overlay} className="rest-url-hl" aria-hidden="true">
        {parts.map((p, i) => (
          <span key={i} className={`u-${p.kind}`}>
            {p.text}
          </span>
        ))}
        {'​'}
      </pre>
      <input
        className="rest-url"
        value={value}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        placeholder="https://server:8443/services/rest/Webservice_name"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (overlay.current) overlay.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter()
        }}
      />
    </div>
  )
}

function JsonText({ text }: { text: string }) {
  const parts = useMemo(() => (text.length > MAX_HIGHLIGHT ? null : tokenizeJson(text)), [text])
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={`j-${p.kind}`}>
          {p.text}
        </span>
      ))}
    </>
  )
}

function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const overlay = useRef<HTMLPreElement | null>(null)
  return (
    <div className="rest-body-wrap">
      <pre ref={overlay} className="rest-body-hl" aria-hidden="true">
        <JsonText text={value} />
        {'\n'}
      </pre>
      <textarea
        className="rest-body"
        value={value}
        aria-label="Request body"
        spellCheck={false}
        placeholder="JSON body"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (overlay.current) {
            overlay.current.scrollTop = e.currentTarget.scrollTop
            overlay.current.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
      />
    </div>
  )
}

function KeyValueTable({ rows, onChange, label }: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; label: string }) {
  const set = (i: number, patch: Partial<KeyValue>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  return (
    <div className="rest-kv" role="group" aria-label={label}>
      <div className="rest-kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`rest-kv-row${r.on ? '' : ' is-off'}`}>
          <input type="checkbox" checked={r.on} aria-label={`${label} ${i + 1} active`} onChange={(e) => set(i, { on: e.target.checked })} />
          <input value={r.key} placeholder="Key" aria-label={`${label} key ${i + 1}`} onChange={(e) => set(i, { key: e.target.value })} />
          <input value={r.value} placeholder="Value" aria-label={`${label} value ${i + 1}`} onChange={(e) => set(i, { value: e.target.value })} />
          <button type="button" className="rest-x" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(rows.filter((_, n) => n !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="rest-add" onClick={() => onChange([...rows, { key: '', value: '', on: true }])}>
        + Add
      </button>
    </div>
  )
}

function splitFull(value: string): { base: string; path: string } {
  const m = /^(https?:\/\/[^/?#]*)(.*)$/i.exec(value.trim())
  return m ? { base: m[1], path: m[2] } : { base: '', path: value.trim() }
}

type ReqTab = 'params' | 'auth' | 'headers' | 'body'

export function RestEditor({ api, projectRoot }: { api: ForgeApi; projectRoot: string }) {
  const [services, setServices] = useState<WebserviceDto[]>([])
  const [users, setUsers] = useState<RestUserDto[]>([])
  const [servers, setServers] = useState<RestServerDto[]>([])
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<WebserviceDto | null>(null)
  const [call, setCall] = useState<RestCall | null>(null)

  const [base, setBase] = useState(() => read(BASE_KEY))
  const [bases, setBases] = useState(() => readList(BASES_KEY))
  const [path, setPath] = useState(`/services/rest/`)
  const [method, setMethod] = useState('GET')
  const [params, setParams] = useState<KeyValue[]>([])
  const [headers, setHeaders] = useState<KeyValue[]>([{ key: 'Accept', value: 'application/json', on: true }])
  const [body, setBody] = useState('')
  const [reqTab, setReqTab] = useState<ReqTab>('params')
  const [resTab, setResTab] = useState<'body' | 'headers' | 'sent'>('body')
  const [insecure, setInsecure] = useState(() => read(INSECURE_KEY) === '1')

  const [loginKind, setLoginKind] = useState<LoginKind>('basic')
  const [user, setUser] = useState(() => read(USER_KEY))
  const [tokenId, setTokenId] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<RestResponseDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .restListWebservices(projectRoot)
      .then((list) => {
        if (cancelled) return
        setServices(list)
        setOpen(new Set(list.filter((w) => w.module === null).map((w) => w.name)))
      })
      .catch(() => setServices([]))
    return () => {
      cancelled = true
    }
  }, [api, projectRoot])

  useEffect(() => {
    let cancelled = false
    api
      .restListServers(projectRoot)
      .then(async (list) => {
        if (cancelled) return
        setServers(list)
        if (read(BASE_KEY) !== '' || list.length === 0) return
        const active = (await api.dbSystems().catch(() => [])).find((e) => e.active)?.system ?? ''
        const name = active.slice(active.lastIndexOf('|') + 1)
        const pick = list.find((s) => s.systems.includes(name)) ?? list[0]
        const url = `https://${pick.host}${REST_ROOT}`
        setBase((cur) => (cur === '' ? url : cur))
      })
      .catch(() => setServers([]))
    return () => {
      cancelled = true
    }
  }, [api, projectRoot])

  useEffect(() => {
    let cancelled = false
    api
      .restUsers()
      .then((list) => {
        if (cancelled) return
        setUsers(list)
        setUser((cur) => (cur !== '' ? cur : (defaultUser(list)?.title ?? '')))
      })
      .catch(() => setUsers([]))
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => {
    if (loginKind !== 'basic' || user.trim() === '' || base.trim() === '') {
      setHasPassword(false)
      return
    }
    let cancelled = false
    api
      .restHasPassword(base, user)
      .then((has) => {
        if (!cancelled) setHasPassword(has)
      })
      .catch(() => setHasPassword(false))
    return () => {
      cancelled = true
    }
  }, [api, base, user, loginKind])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.rest-more')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  useEffect(() => {
    setChanging(false)
    setMenuOpen(false)
    setPassword('')
  }, [base, user])

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q === '' ? services : services.filter((w) => w.name.toLowerCase().includes(q))
    const map = new Map<string, WebserviceDto[]>()
    for (const w of list) map.set(w.module ?? 'Project', [...(map.get(w.module ?? 'Project') ?? []), w])
    return [...map.entries()]
  }, [services, filter])

  const fullUrl = withQuery(joinUrl(base, path), params)

  function choose(ws: WebserviceDto, c: RestCall) {
    setSelected(ws)
    setCall(c)
    setMethod(c.method)
    setPath(c.path)
    setParams([])
    setBody(bodyTemplate(c))
    setLoginKind(loginKindOf(ws))
    setHeaders((hs) => {
      const rest = hs.filter((h) => h.key.toLowerCase() !== 'content-type')
      return BODY_METHODS.includes(c.method) ? [...rest, { key: 'Content-Type', value: 'application/json', on: true }] : rest
    })
    setReqTab(BODY_METHODS.includes(c.method) ? 'body' : 'params')
    setResponse(null)
    setError(null)
  }

  function changeFull(value: string) {
    const split = splitFull(value)
    if (split.base !== '') {
      setBase(split.base)
      write(BASE_KEY, split.base)
    }
    const parsed = splitQuery(split.path)
    setPath(parsed.path)
    setParams([...parsed.params, ...params.filter((p) => !p.on)])
  }

  function changeBase(value: string) {
    setBase(value)
    write(BASE_KEY, value)
  }

  function changeMethod(m: string) {
    setMethod(m)
    if (BODY_METHODS.includes(m) && !headers.some((h) => h.key.toLowerCase() === 'content-type')) setHeaders([...headers, { key: 'Content-Type', value: 'application/json', on: true }])
  }

  function changeUser(value: string) {
    setUser(value)
    write(USER_KEY, value)
  }

  function addChip(key: string, value: string) {
    if (params.some((p) => p.key === key)) return
    setParams([...params, { key, value, on: true }])
    setReqTab('params')
  }

  async function savePassword() {
    if (password === '' || user.trim() === '' || base.trim() === '') return
    try {
      await api.restSavePassword(base, user, password)
      setPassword('')
      setChanging(false)
      setHasPassword(true)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function forgetPassword() {
    await api.restForgetPassword(base, user).catch(() => undefined)
    setMenuOpen(false)
    setChanging(false)
    setHasPassword(false)
  }

  async function send() {
    if (busy) return
    if (!/^https?:\/\//i.test(fullUrl)) {
      setError('Enter the server URL first, for example https://localhost:8443')
      return
    }
    if (/\{[^}]*\}/.test(fullUrl)) {
      setError('Replace {id} in the URL with the id of a record.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const hs = headers.filter((h) => h.on && h.key.trim() !== '').map((h) => [h.key.trim(), h.value] as [string, string])
      const kind: LoginKind = loginKind === 'basic' && user.trim() === '' ? 'none' : loginKind
      const res = await api.restSend({
        url: fullUrl,
        method,
        headers: hs,
        body: BODY_METHODS.includes(method) || body !== '' ? body : null,
        auth: { kind, user: user.trim(), tokenId },
        insecure,
      })
      setResponse(res)
      setResTab('body')
      const list = [base, ...bases.filter((b) => b !== base)].filter((b) => b.trim() !== '').slice(0, 10)
      setBases(list)
      write(BASES_KEY, JSON.stringify(list))
      write(INSECURE_KEY, insecure ? '1' : '0')
      logOutput('default', `REST ${method} ${fullUrl} → ${res.status} ${res.reason} (${res.elapsedMs} ms)`, res.status >= 400 ? 'error' : undefined)
    } catch (e) {
      const text = errorText(e)
      setResponse(null)
      if (text.includes('PASSWORD_REQUIRED')) {
        setReqTab('auth')
        setError(`No password saved for ${user} on this server yet. Enter it once under Authorization, it is kept in the system keychain afterwards.`)
      } else {
        setError(text)
      }
    } finally {
      setBusy(false)
    }
  }

  async function copyBody(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const pretty = response ? prettyBody(response) : ''
  const methodsOfSelected = selected ? selected.methods.join(', ') : ''
  const tab = (id: ReqTab, label: string, badge?: ReactNode) => (
    <button type="button" role="tab" aria-selected={reqTab === id} className={`rest-tab${reqTab === id ? ' is-active' : ''}`} onClick={() => setReqTab(id)}>
      {label}
      {badge}
    </button>
  )

  return (
    <div className="rest-root">
      <aside className="rest-side" aria-label="Web services">
        <input className="rest-filter" value={filter} placeholder="Filter web services" aria-label="Filter web services" onChange={(e) => setFilter(e.target.value)} />
        <div className="rest-list">
          {groups.length === 0 ? <p className="rest-empty">No entity web services in this project.</p> : null}
          {groups.map(([group, list]) => (
            <section key={group}>
              <h4>{group}</h4>
              {list.map((ws) => {
                const calls = callsOf(ws)
                const isOpen = open.has(ws.name) || filter.trim() !== ''
                return (
                  <div key={`${group}/${ws.name}`} className="rest-ws">
                    <button
                      type="button"
                      className={`rest-ws-head${selected?.name === ws.name ? ' is-selected' : ''}`}
                      aria-expanded={isOpen}
                      onClick={() => setOpen((cur) => { const next = new Set(cur); if (!next.delete(ws.name)) next.add(ws.name); return next })}
                    >
                      <span className="rest-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="rest-ws-name">{ws.name}</span>
                    </button>
                    {isOpen
                      ? calls.length === 0
                        ? <p className="rest-empty rest-nomethods">No method is allowed.</p>
                        : calls.map((c) => (
                            <button key={c.id} type="button" className={`rest-item${call?.id === c.id ? ' is-active' : ''}`} title={`${c.method} ${c.path}`} onClick={() => choose(ws, c)}>
                              <span className={`rest-method m-${c.method}`}>{c.method}</span>
                              <span className="rest-item-name">{c.label}</span>
                            </button>
                          ))
                      : null}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </aside>

      <div className="rest-main">
        <div className="rest-conn">
          <label className="rest-base">
            <span>Server</span>
            <input value={base} list="rest-bases" aria-label="Server URL" spellCheck={false} placeholder="https://server:8443" onChange={(e) => changeBase(e.target.value)} />
            <datalist id="rest-bases">
              {[...servers.map((s) => `https://${s.host}${REST_ROOT}`), ...bases.filter((b) => !servers.some((s) => b === `https://${s.host}${REST_ROOT}`))].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="rest-check" title="Accept a certificate that is self-signed or does not match the name">
            <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
            <span>Accept untrusted certificate</span>
          </label>
        </div>

        {servers.length > 0 ? (
          <div className="rest-servers" aria-label="Servers of the systems">
            {servers.map((s) => {
              const url = `https://${s.host}${REST_ROOT}`
              return (
                <button key={s.host} type="button" className={`rest-chip${base.replace(/\/+$/, '') === url ? ' is-on' : ''}`} title={url} onClick={() => changeBase(url)}>
                  {s.systems.join(', ')}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="rest-bar">
          <select value={method} onChange={(e) => changeMethod(e.target.value)} aria-label="Method" className={`rest-methodpick m-${method}`}>
            {(selected ? [...new Set(callsOf(selected).map((c) => c.method))] : [...METHODS]).map((m) => (
              <option key={m}>{m}</option>
            ))}
            {selected && !callsOf(selected).some((c) => c.method === method) ? <option>{method}</option> : null}
          </select>
          <HighlightedUrl value={fullUrl} onChange={changeFull} onEnter={() => void send()} label="Request URL" />
          <button type="button" className="rest-send" disabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        {selected ? (
          <p className="rest-hint">
            <strong>{selected.name}</strong> allows {methodsOfSelected === '' ? 'no method' : methodsOfSelected}
          </p>
        ) : null}

        <div className="rest-tabs" role="tablist" aria-label="Request">
          {tab('params', 'Params', params.filter((p) => p.on && p.key !== '').length > 0 ? <span className="rest-badge">{params.filter((p) => p.on && p.key !== '').length}</span> : null)}
          {tab('auth', 'Authorization', loginKind === 'basic' && !hasPassword ? <span className="rest-dot" title="No password saved yet" /> : null)}
          {tab('headers', 'Headers', <span className="rest-badge">{headers.filter((h) => h.on && h.key !== '').length}</span>)}
          {tab('body', 'Body', body.trim() !== '' ? <span className="rest-dot is-on" /> : null)}
        </div>
        <div className="rest-pane">
          {reqTab === 'params' ? (
            <>
              <div className="rest-chips" aria-label="Add a parameter">
                {PARAM_CHIPS.map((c) => (
                  <button key={c.key} type="button" className="rest-chip" title={c.hint} disabled={params.some((p) => p.key === c.key)} onClick={() => addChip(c.key, c.value)}>
                    + {c.key}
                  </button>
                ))}
              </div>
              <KeyValueTable rows={params} onChange={setParams} label="Param" />
            </>
          ) : null}
          {reqTab === 'auth' ? (
            <div className="rest-auth">
              <label>
                <span>Type</span>
                <select value={loginKind} aria-label="Authorization type" onChange={(e) => setLoginKind(e.target.value as LoginKind)}>
                  <option value="basic">Basic (user and password)</option>
                  <option value="usertoken">Usertoken</option>
                  <option value="none">No authorization</option>
                </select>
              </label>
              {selected ? <p className="rest-hint">Login type of the web service: {selected.loginTypes.length > 0 ? selected.loginTypes.join(', ') : 'not set (default)'}</p> : null}
              {loginKind === 'basic' ? (
                <>
                  <label>
                    <span>User</span>
                    {users.length > 0 ? (
                      <select value={user} aria-label="User" onChange={(e) => changeUser(e.target.value)}>
                        {users.some((u) => u.title === user) || user === '' ? null : <option value={user}>{user}</option>}
                        {users.map((u) => (
                          <option key={u.id} value={u.title}>
                            {u.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value={user} aria-label="User" placeholder="Web service user" onChange={(e) => changeUser(e.target.value)} />
                    )}
                  </label>
                  {hasPassword && !changing ? (
                    <div className="rest-saved-row">
                      <span className="rest-saved">Password saved in the system keychain.</span>
                      <div className="rest-more">
                        <button type="button" className="rest-dots" aria-label="Password options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                          ⋯
                        </button>
                        {menuOpen ? (
                          <div className="rest-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => { setChanging(true); setMenuOpen(false) }}>
                              Change password
                            </button>
                            <button type="button" role="menuitem" onClick={() => void forgetPassword()}>
                              Forget password
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="rest-pw">
                      <label>
                        <span>{changing ? 'New password' : 'Password'}</span>
                        <input type="password" value={password} autoComplete="off" aria-label={changing ? 'New password' : 'Password'} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      <div className="rest-pw-actions">
                        <button type="button" disabled={password === '' || user.trim() === ''} onClick={() => void savePassword()}>
                          {changing ? 'Save new password' : 'Save once'}
                        </button>
                        {changing ? (
                          <button type="button" onClick={() => { setChanging(false); setPassword('') }}>
                            Cancel
                          </button>
                        ) : null}
                      </div>
                      <p className="rest-hint">{changing ? 'The old password is replaced.' : 'Needed once per server and user. After that every call signs in by itself.'}</p>
                    </div>
                  )}
                </>
              ) : null}
              {loginKind === 'usertoken' ? (
                <label>
                  <span>Token id</span>
                  <input value={tokenId} aria-label="Token id" placeholder="Id of the usertoken" onChange={(e) => setTokenId(e.target.value)} />
                </label>
              ) : null}
            </div>
          ) : null}
          {reqTab === 'headers' ? <KeyValueTable rows={headers} onChange={setHeaders} label="Header" /> : null}
          {reqTab === 'body' ? <BodyEditor value={body} onChange={setBody} /> : null}
        </div>

        <div className="rest-res">
          {error ? <p className="rest-error" role="alert">{error}</p> : null}
          {response && response.status === 401 && loginKind === 'basic' ? (
            <p className="rest-error" role="alert">
              The server rejected the login of {user === '' ? 'this call' : user}
              {response.headers.find(([k]) => k.toLowerCase() === 'www-authenticate') ? ` (it asks for: ${response.headers.find(([k]) => k.toLowerCase() === 'www-authenticate')?.[1]})` : ''}. If the password is wrong, change it.{' '}
              <button type="button" className="rest-link" onClick={() => { setReqTab('auth'); setChanging(true) }}>
                Change password
              </button>
            </p>
          ) : null}
          {response ? (
            <>
              <div className="rest-res-bar">
                <span className={`rest-status s-${statusClass(response.status)}`}>
                  {response.status} {response.reason}
                </span>
                <span className="rest-meta">{response.elapsedMs} ms</span>
                <span className="rest-meta">{formatSize(response.size)}</span>
                <span className="rest-spacer" />
                <button type="button" className={`rest-tab${resTab === 'body' ? ' is-active' : ''}`} onClick={() => setResTab('body')}>
                  Body
                </button>
                <button type="button" className={`rest-tab${resTab === 'headers' ? ' is-active' : ''}`} onClick={() => setResTab('headers')}>
                  Headers <span className="rest-badge">{response.headers.length}</span>
                </button>
                <button type="button" className={`rest-tab${resTab === 'sent' ? ' is-active' : ''}`} onClick={() => setResTab('sent')}>
                  Sent request
                </button>
                <button type="button" onClick={() => void copyBody(resTab === 'body' ? pretty : resTab === 'sent' ? response.sent : response.headers.map(([k, v]) => `${k}: ${v}`).join('\n'))}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {resTab === 'body' ? (
                <pre className="rest-code" aria-label="Response body">
                  <JsonText text={pretty} />
                </pre>
              ) : resTab === 'sent' ? (
                <pre className="rest-code" aria-label="Sent request">
                  {response.sent}
                </pre>
              ) : (
                <table className="rest-headers" aria-label="Response headers">
                  <tbody>
                    {response.headers.map(([k, v], i) => (
                      <tr key={i}>
                        <th>{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : error ? null : (
            <p className="rest-empty rest-placeholder">Pick a call on the left, check the URL and press Send.</p>
          )}
        </div>
      </div>
    </div>
  )
}
