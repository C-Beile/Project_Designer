import { configGet, configSet } from '../settings/appConfig'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { RestResponseDto, RestServerDto, RestUserDto, WebserviceDto } from '../wire/types'
import { errorText } from '../core/errorText'
import { logOutput } from '../core/outputBus'
import { confirmDialog } from '../core/dialogService'
import {
  METHODS,
  REST_ROOT,
  PARAM_CHIPS,
  WRITE_METHODS,
  bodyTemplate,
  callsOf,
  defaultUser,
  isCustom,
  joinUrl,
  loginKindOf,
  serverTone,
  splitQuery,
  systemTone,
  tokenizeUrl,
  withQuery,
  type HistoryEntry,
  type KeyValue,
  type LoginKind,
  type RestCall,
} from './restTools'
import { Button, Dropdown, Input, TextArea } from '../core/ui/controls'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'
import { JsonText } from './RestJson'
import { RestResponse } from './RestResponse'
import { RestSidebar } from './RestSidebar'

// Zuletzt benutzte Werte des REST-Clients, Abschnitt [rest] in designer.conf (nie das Passwort: das liegt im Schlüsselbund).
const BASE_KEY = 'base'
const BASES_KEY = 'bases'
const USER_KEY = 'user'
const INSECURE_KEY = 'insecure'
const BODY_METHODS = ['POST', 'PUT', 'PATCH']
const HISTORY_LIMIT = 25

function read(key: string, fallback = ''): string {
  const value = configGet<unknown>('rest', key)
  return typeof value === 'string' ? value : fallback
}

/** Leerer Text = nicht gesetzt: der Eintrag fehlt dann in der Datei. */
function write(key: string, value: string): void {
  configSet(['rest', key], value === '' ? undefined : value)
}

function readList(key: string): string[] {
  const list = configGet<unknown>('rest', key)
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string').slice(0, 10) : []
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
      <Input
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

function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const overlay = useRef<HTMLPreElement | null>(null)
  return (
    <div className="rest-body-wrap">
      <pre ref={overlay} className="rest-body-hl" aria-hidden="true">
        <JsonText text={value} />
        {'\n'}
      </pre>
      <TextArea
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
          <Input type="checkbox" checked={r.on} aria-label={`${label} ${i + 1} active`} onChange={(e) => set(i, { on: e.target.checked })} />
          <Input value={r.key} placeholder="Key" aria-label={`${label} key ${i + 1}`} onChange={(e) => set(i, { key: e.target.value })} />
          <Input value={r.value} placeholder="Value" aria-label={`${label} value ${i + 1}`} onChange={(e) => set(i, { value: e.target.value })} />
          <Button variant="bare" className="rest-x" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(rows.filter((_, n) => n !== i))}>
            ×
          </Button>
        </div>
      ))}
      <Button variant="bare" className="rest-add" onClick={() => onChange([...rows, { key: '', value: '', on: true }])}>
        + Add
      </Button>
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
  const [history, setHistory] = useState<HistoryEntry[]>([])
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
  const [insecure, setInsecure] = useState(() => configGet<boolean>('rest', INSECURE_KEY) === true)

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

  useAbortableEffect((signal) => {
    api
      .restListWebservices(projectRoot)
      .then((list) => {
        if (signal.aborted) return
        setServices(list)
      })
      .catch(() => setServices([]))
  }, [api, projectRoot])

  useAbortableEffect((signal) => {
    api
      .restListServers(projectRoot)
      .then(async (list) => {
        if (signal.aborted) return
        setServers(list)
        if (read(BASE_KEY) !== '' || list.length === 0) return
        const active = (await api.dbSystems().catch(() => [])).find((e) => e.active)?.system ?? ''
        const name = active.slice(active.lastIndexOf('|') + 1)
        const pick = list.find((s) => s.systems.includes(name)) ?? list[0]
        const url = `https://${pick.host}${REST_ROOT}`
        setBase((cur) => (cur === '' ? url : cur))
      })
      .catch(() => setServers([]))
  }, [api, projectRoot])

  useAbortableEffect((signal) => {
    api
      .restUsers()
      .then((list) => {
        if (signal.aborted) return
        setUsers(list)
        setUser((cur) => (cur !== '' ? cur : (defaultUser(list)?.title ?? '')))
      })
      .catch(() => setUsers([]))
  }, [api])

  useAbortableEffect((signal) => {
    if (loginKind !== 'basic' || user.trim() === '' || base.trim() === '') {
      setHasPassword(false)
      return
    }
    api
      .restHasPassword(base, user)
      .then((has) => {
        if (!signal.aborted) setHasPassword(has)
      })
      .catch(() => setHasPassword(false))
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

  const fullUrl = withQuery(joinUrl(base, path), params)
  const baseTone = useMemo(() => {
    const url = base.replace(/\/+$/, '')
    const known = servers.find((s) => `https://${s.host}${REST_ROOT}` === url || url.startsWith(`https://${s.host}`))
    if (known) return serverTone(known.systems, known.host)
    return systemTone(url.replace(/^https?:\/\//i, ''))
  }, [base, servers])

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

  function restore(h: HistoryEntry) {
    setBase(h.base)
    write(BASE_KEY, h.base)
    setPath(h.path)
    setMethod(h.method)
    setParams(h.params)
    setHeaders(h.headers)
    setBody(h.body)
    setSelected(services.find((w) => w.name === h.serviceName) ?? null)
    setCall(null)
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
    if (baseTone === 'prod' && WRITE_METHODS.includes(method)) {
      const sure = await confirmDialog(`This call changes data on a production server:\n${method} ${fullUrl}`, { title: 'Production server', okLabel: `Send ${method}` })
      if (!sure) return
    }
    setBusy(true)
    setError(null)
    const rememberCall = (status: number | null, elapsedMs: number | null) =>
      setHistory((cur) => [{ id: Date.now() + cur.length, method, url: fullUrl, status, elapsedMs, at: Date.now(), serviceName: selected?.name ?? null, base, path, params, headers, body }, ...cur].slice(0, HISTORY_LIMIT))
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
      rememberCall(res.status, res.elapsedMs)
      const list = [base, ...bases.filter((b) => b !== base)].filter((b) => b.trim() !== '').slice(0, 10)
      setBases(list)
      configSet(['rest', BASES_KEY], list)
      configSet(['rest', INSECURE_KEY], insecure ? true : undefined)
      logOutput('default', `REST ${method} ${fullUrl} → ${res.status} ${res.reason} (${res.elapsedMs} ms)`, res.status >= 400 ? 'error' : undefined)
    } catch (e) {
      const text = errorText(e)
      setResponse(null)
      if (!text.includes('PASSWORD_REQUIRED')) rememberCall(null, null)
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

  const methodsOfSelected = selected ? selected.methods.join(', ') : ''
  const paramChips = selected && isCustom(selected) ? selected.params.map((p) => ({ key: p.name, value: '', hint: `${p.kind ?? 'any type'}${p.mandatory ? ', required' : ''}`, mandatory: p.mandatory })) : PARAM_CHIPS.map((c) => ({ ...c, mandatory: false }))
  const tab = (id: ReqTab, label: string, badge?: ReactNode) => (
    <Button variant="bare" role="tab" aria-selected={reqTab === id} className={`rest-tab${reqTab === id ? ' is-active' : ''}`} onClick={() => setReqTab(id)}>
      {label}
      {badge}
    </Button>
  )

  return (
    <div
      className="rest-root"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          void send()
        }
      }}
    >
      <RestSidebar services={services} selected={selected} call={call} onChoose={choose} history={history} onRestore={restore} now={Date.now()} />

      <div className="rest-main">
        <div className="rest-conn">
          <label className="rest-base">
            <span>Server</span>
            <Input value={base} list="rest-bases" aria-label="Server URL" spellCheck={false} placeholder="https://server:8443" onChange={(e) => changeBase(e.target.value)} />
            <datalist id="rest-bases">
              {[...servers.map((s) => `https://${s.host}${REST_ROOT}`), ...bases.filter((b) => !servers.some((s) => b === `https://${s.host}${REST_ROOT}`))].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="rest-check" title="Accept a certificate that is self-signed or does not match the name">
            <Input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
            <span>Accept untrusted certificate</span>
          </label>
        </div>

        {servers.length > 0 ? (
          <div className="rest-servers" aria-label="Servers of the systems">
            {servers.map((s) => {
              const url = `https://${s.host}${REST_ROOT}`
              return (
                <Button key={s.host} variant="bare" className={`rest-chip tone-${serverTone(s.systems, s.host)}${base.replace(/\/+$/, '') === url ? ' is-on' : ''}`} title={url} onClick={() => changeBase(url)}>
                  <span className="rest-tonedot" aria-hidden="true" />
                  {s.systems.join(', ')}
                </Button>
              )
            })}
          </div>
        ) : null}

        {baseTone === 'prod' ? (
          <p className="rest-prodbar" role="note">
            Production server: calls that change data ask for confirmation first.
          </p>
        ) : null}

        <div className={`rest-bar m-bar-${method}`}>
          <Dropdown value={method} aria-label="Method" className={`rest-methodpick m-${method}`} onChange={(v) => changeMethod(v)} options={[...new Set([...(selected ? callsOf(selected).map((c) => c.method) : [...METHODS]), method])].map((m) => ({ id: m, label: m }))} />
          <HighlightedUrl value={fullUrl} onChange={changeFull} onEnter={() => void send()} label="Request URL" />
          <Button variant="bare" className="rest-send" isDisabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {selected ? (
          <p className="rest-hint rest-selected">
            <span className={`rest-kind k-${isCustom(selected) ? 'custom' : 'entity'}`}>{isCustom(selected) ? 'C' : 'E'}</span>
            <strong>{selected.name}</strong>
            <span>{isCustom(selected) ? 'custom web service' : 'entity web service'}, allows</span>
            {methodsOfSelected === '' ? (
              <span>no method</span>
            ) : (
              selected.methods.map((m) => (
                <span key={m} className={`rest-mpill m-${m.toUpperCase()}`}>
                  {m.toUpperCase()}
                </span>
              ))
            )}
            {isCustom(selected) && selected.accepts ? <span className="rest-meta">takes {selected.accepts}</span> : null}
            {isCustom(selected) && selected.delivers ? <span className="rest-meta">returns {selected.delivers}</span> : null}
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
                {paramChips.map((c) => (
                  <Button variant="bare" key={c.key} className={`rest-chip${c.mandatory ? ' is-required' : ''}`} title={c.hint} isDisabled={params.some((p) => p.key === c.key)} onClick={() => addChip(c.key, c.value)}>
                    + {c.key}
                    {c.mandatory ? <span className="rest-req" aria-label="required">*</span> : null}
                  </Button>
                ))}
                {selected && isCustom(selected) && selected.params.length === 0 ? <span className="rest-hint">The script reads no query parameter that could be found. Add your own below.</span> : null}
              </div>
              <KeyValueTable rows={params} onChange={setParams} label="Param" />
            </>
          ) : null}
          {reqTab === 'auth' ? (
            <div className="rest-auth">
              <label>
                <span>Type</span>
                <Dropdown value={loginKind} aria-label="Authorization type" options={[{ id: "basic", label: "Basic (user and password)" }, { id: "usertoken", label: "Usertoken" }, { id: "none", label: "No authorization" }]} onChange={(v) => setLoginKind(v as LoginKind)} />
              </label>
              {selected ? <p className="rest-hint">Login type of the web service: {selected.loginTypes.length > 0 ? selected.loginTypes.join(', ') : 'not set (default)'}</p> : null}
              {loginKind === 'basic' ? (
                <>
                  <label>
                    <span>User</span>
                    {users.length > 0 ? (
                      <Dropdown value={user} aria-label="User" onChange={(v) => changeUser(v)} options={[...(users.some((u) => u.title === user) || user === '' ? [] : [{ id: user, label: user }]), ...users.map((u) => ({ id: u.title, label: u.title }))]} />
                    ) : (
                      <Input value={user} aria-label="User" placeholder="Web service user" onChange={(e) => changeUser(e.target.value)} />
                    )}
                  </label>
                  {hasPassword && !changing ? (
                    <div className="rest-saved-row">
                      <span className="rest-saved">Password saved in the system keychain.</span>
                      <div className="rest-more">
                        <Button variant="bare" className="rest-dots" aria-label="Password options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                          ⋯
                        </Button>
                        {menuOpen ? (
                          <div className="rest-menu" role="menu">
                            <Button variant="bare" role="menuitem" onClick={() => { setChanging(true); setMenuOpen(false) }}>
                              Change password
                            </Button>
                            <Button variant="bare" role="menuitem" onClick={() => void forgetPassword()}>
                              Forget password
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="rest-pw">
                      <label>
                        <span>{changing ? 'New password' : 'Password'}</span>
                        <Input type="password" value={password} autoComplete="off" aria-label={changing ? 'New password' : 'Password'} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      <div className="rest-pw-actions">
                        <Button variant="bare" isDisabled={password === '' || user.trim() === ''} onClick={() => void savePassword()}>
                          {changing ? 'Save new password' : 'Save once'}
                        </Button>
                        {changing ? (
                          <Button variant="bare" onClick={() => { setChanging(false); setPassword('') }}>
                            Cancel
                          </Button>
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
                  <Input value={tokenId} aria-label="Token id" placeholder="Id of the usertoken" onChange={(e) => setTokenId(e.target.value)} />
                </label>
              ) : null}
            </div>
          ) : null}
          {reqTab === 'headers' ? <KeyValueTable rows={headers} onChange={setHeaders} label="Header" /> : null}
          {reqTab === 'body' ? <BodyEditor value={body} onChange={setBody} /> : null}
        </div>

        <RestResponse
          response={response}
          error={error}
          loginKind={loginKind}
          user={user}
          onChangePassword={() => {
            setReqTab('auth')
            setChanging(true)
          }}
        />
      </div>
    </div>
  )
}
