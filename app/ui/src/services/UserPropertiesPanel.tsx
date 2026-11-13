import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { UserPropertyDto } from '../wire/types'
import { confirmDialog } from '../core/dialogService'
import { notifyUsersChanged, type UserSelection } from './userSelection'
import { errorText } from '../core/errorText'

// Properties panel of a user selected in the Users tab, laid out like the original Designer:
// the tabs Properties, Extended and Internal; General, Security and Personal as sections. Values
// that are not set are shown grey and empty. Nothing is written before the user confirmed the list
// of changes; passwords and keys are never shown or changed.

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: 'General', keys: ['calendarID', 'email', 'isActive', 'isBlocked', 'lastModified', 'name', 'roleNames', 'title'] },
  { title: 'Security', keys: ['lastLogin', 'lastLogout', 'password', 'passwordChanged', 'passwordHistory'] },
  { title: 'Personal', keys: ['contactID', 'description', 'firstname', 'lastname'] },
]
const KNOWN = new Set(SECTIONS.flatMap((s) => s.keys.map((k) => k.toLowerCase())))
const BOOLEANS = new Set(['isactive', 'isblocked'])
const READ_ONLY_KEYS = new Set(['lastmodified', 'name', 'lastlogin', 'lastlogout', 'passwordchanged'])
const SECRET_KEYS = new Set(['password', 'passwordhistory'])
const LIST_KEYS = new Set(['rolenames'])

type Tab = 'properties' | 'extended' | 'internal'

interface Field {
  key: string
  /** Rows of the database that carry this key (several for list values such as roleNames). */
  rows: UserPropertyDto[]
}

function fieldsByKey(props: UserPropertyDto[]): Map<string, Field> {
  const map = new Map<string, Field>()
  for (const p of props) {
    const k = p.key.toLowerCase()
    const f = map.get(k) ?? { key: p.key, rows: [] }
    f.rows.push(p)
    map.set(k, f)
  }
  return map
}

export function UserPropertiesPanel({ api, selection }: { api: ForgeApi; selection: UserSelection }) {
  const { user, systemKey, systemName } = selection
  const [tab, setTab] = useState<Tab>('properties')
  const [props, setProps] = useState<UserPropertyDto[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [listEdits, setListEdits] = useState<Record<string, string[]>>({})
  const [roles, setRoles] = useState<string[]>([])
  const [systemRoles, setSystemRoles] = useState<string[]>([])
  const [openList, setOpenList] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')

  useEffect(() => {
    let cancelled = false
    setProps(null)
    setEdits({})
    setListEdits({})
    setOpenList(null)
    setError(null)
    void (async () => {
      await api.dbActivate(systemKey).catch(() => false)
      void api.systemAssignedRoles().then((r) => !cancelled && setSystemRoles(r)).catch(() => undefined)
      return api.systemUserProperties(user)
    })()
      .then((p) => !cancelled && setProps(p))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, user, systemKey, tick])

  useEffect(() => {
    const root = systemKey.split('|')[0]
    if (!root) return
    let cancelled = false
    api
      .listProjectModels(root)
      .then((models) => !cancelled && setRoles(models.filter((m) => m.folder === 'role').map((m) => m.name).sort((a, b) => a.localeCompare(b))))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, systemKey])

  const byKey = useMemo(() => fieldsByKey(props ?? []), [props])
  const currentOf = (key: string): string => byKey.get(key.toLowerCase())?.rows[0]?.value ?? ''
  const valuesOf = (key: string): string[] => (byKey.get(key.toLowerCase())?.rows ?? []).map((r) => r.value ?? '').filter((v) => v !== '')
  const changedSingles = Object.entries(edits).filter(([key, value]) => value !== currentOf(key))
  const changedLists = Object.entries(listEdits).filter(([key, value]) => value.slice().sort().join('\u0000') !== valuesOf(key).slice().sort().join('\u0000'))
  const changeCount = changedSingles.length + changedLists.length

  async function save() {
    if (changeCount === 0) return
    const nl = String.fromCharCode(10)
    const lines = [
      ...changedSingles.map(([key, value]) => `${key}: "${currentOf(key)}" -> "${value}"`),
      ...changedLists.map(([key, value]) => `${key}: [${valuesOf(key).join(', ')}] -> [${value.join(', ')}]`),
    ].join(nl)
    const yes = await confirmDialog(`Write ${changeCount} change${changeCount === 1 ? '' : 's'} of ${selection.title || user} into the system database of ${systemName}?${nl}${nl}${lines}`, { title: 'Save user', okLabel: 'Save' })
    if (!yes) return
    setSaving(true)
    setError(null)
    try {
      await api.dbActivate(systemKey).catch(() => false)
      for (const [key, value] of changedSingles) await api.systemUserSet(user, key, value, true)
      for (const [key, value] of changedLists) await api.systemUserSetList(user, key, value, true)
      notifyUsersChanged()
      setTick((n) => n + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    if (pw1 === '' || pw1 !== pw2) {
      setError(pw1 === '' ? 'Enter a new password.' : 'The two passwords are not the same.')
      return
    }
    const yes = await confirmDialog(`Set a new password for ${selection.title || user} in the system database of ${systemName}?`, { title: 'Change password', okLabel: 'Change password' })
    if (!yes) return
    setSaving(true)
    setError(null)
    try {
      await api.dbActivate(systemKey).catch(() => false)
      await api.systemUserSetPassword(user, pw1, true)
      setPwOpen(false)
      setPw1('')
      setPw2('')
      notifyUsersChanged()
      setTick((n) => n + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const row = (key: string) => {
    const lower = key.toLowerCase()
    const field = byKey.get(lower)
    const isSet = (field?.rows.length ?? 0) > 0
    if (SECRET_KEYS.has(lower)) {
      return (
        <div className="up-row" key={key}>
          <span className={`up-name${isSet ? '' : ' is-unset'}`}>{key}</span>
          <span className="up-value">
            {isSet ? '***' : ''}
            {lower === 'password' ? (
              <button type="button" className="up-pw-button" disabled={saving} onClick={() => setPwOpen((o) => !o)}>
                Change password...
              </button>
            ) : null}
          </span>
          {lower === 'password' && pwOpen ? (
            <div className="up-pw-form">
              <input type="password" autoComplete="off" aria-label="New password" placeholder="New password" value={pw1} onChange={(e) => setPw1(e.target.value)} />
              <input type="password" autoComplete="off" aria-label="Repeat new password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              <div className="up-pw-actions">
                <button type="button" disabled={saving || pw1 === ''} onClick={() => void changePassword()}>
                  Save password
                </button>
                <button type="button" onClick={() => { setPwOpen(false); setPw1(''); setPw2('') }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )
    }
    if (LIST_KEYS.has(lower)) {
      const selected = listEdits[key] ?? valuesOf(key)
      const options = [...new Set([...systemRoles, ...roles, ...selected])].sort((a, b) => a.localeCompare(b))
      const isChanged = listEdits[key] !== undefined && changedLists.some(([k]) => k === key)
      return (
        <div className={`up-row up-list${isChanged ? ' is-changed' : ''}`} key={key}>
          <span className={`up-name${isSet ? '' : ' is-unset'}`}>{key}</span>
          <div className="up-listbox">
            <button type="button" className="up-list-button" aria-label={key} aria-expanded={openList === key} onClick={() => setOpenList(openList === key ? null : key)}>
              <span>[{selected.join(', ')}]</span>
              <span aria-hidden="true">{'▾'}</span>
            </button>
            {openList === key ? (
              <div className="up-list-menu" role="listbox" aria-label={`${key} values`}>
                {options.length === 0 ? <p className="forge-field-hint">No roles found in the project.</p> : null}
                {options.map((o) => (
                  <label key={o}>
                    <input
                      type="checkbox"
                      checked={selected.includes(o)}
                      onChange={(e) => setListEdits((prev) => ({ ...prev, [key]: e.target.checked ? [...selected, o] : selected.filter((v) => v !== o) }))}
                    />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )
    }
    if ((field?.rows.length ?? 0) > 1) {
      return (
        <div className="up-row" key={key}>
          <span className="up-name">{key}</span>
          <span className="up-value" title={field?.rows.map((r) => r.value ?? '').join(', ')}>
            [{field?.rows.map((r) => r.value ?? '').join(', ')}]
          </span>
        </div>
      )
    }
    const readOnly = READ_ONLY_KEYS.has(lower)
    const stored = currentOf(key)
    const current = edits[key] ?? stored
    const isChanged = edits[key] !== undefined && edits[key] !== stored
    return (
      <div className={`up-row${isChanged ? ' is-changed' : ''}`} key={key}>
        <span className={`up-name${isSet ? '' : ' is-unset'}`}>{key}</span>
        {BOOLEANS.has(lower) ? (
          <input type="checkbox" aria-label={key} checked={current.toLowerCase() === 'true'} onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.checked ? 'true' : 'false' }))} />
        ) : (
          <input
            type="text"
            aria-label={key}
            value={lower === 'lastmodified' && current ? formatStamp(current) : current}
            readOnly={readOnly}
            title={!isSet && !readOnly ? 'Not set for this user yet' : undefined}
            onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        )}
      </div>
    )
  }

  const extra = (props ?? []).filter((p) => !KNOWN.has(p.key.toLowerCase()))
  const groups = [...new Set(extra.map((p) => p.group))]

  return (
    <div className="user-props" aria-label="User properties">
      <div className="user-props-tabs" role="tablist">
        {(['properties', 'extended', 'internal'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : undefined} onClick={() => setTab(t)}>
            {t === 'properties' ? 'Properties' : t === 'extended' ? 'Extended' : 'Internal'}
          </button>
        ))}
        <span className="user-props-actions">
          <button type="button" title="Read the properties again" aria-label="Reload properties" onClick={() => setTick((n) => n + 1)}>
            {'↻'}
          </button>
          <button type="button" className="is-primary" disabled={changeCount === 0 || saving} onClick={() => void save()}>
            {saving ? 'Saving...' : `Save${changeCount ? ` (${changeCount})` : ''}`}
          </button>
        </span>
      </div>
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {props === null && !error ? <p className="forge-field-hint">Reading the properties...</p> : null}
      {props !== null && tab === 'properties'
        ? SECTIONS.map((s) => (
            <section key={s.title}>
              <h4>{s.title}</h4>
              {s.keys.map(row)}
            </section>
          ))
        : null}
      {props !== null && tab === 'extended' ? (
        groups.length === 0 ? (
          <p className="forge-field-hint">This user has no further properties.</p>
        ) : (
          groups.map((g) => (
            <section key={g || '(none)'}>
              <h4>{g || '(no group)'}</h4>
              {[...new Set(extra.filter((p) => p.group === g).map((p) => p.key))].map(row)}
            </section>
          ))
        )
      ) : null}
      {props !== null && tab === 'internal' ? (
        <section>
          <h4>Database</h4>
          <div className="up-row">
            <span className="up-name">user id</span>
            <span className="up-value">{user}</span>
          </div>
          <div className="up-row">
            <span className="up-name">system</span>
            <span className="up-value">{systemName}</span>
          </div>
          <div className="up-row">
            <span className="up-name">properties</span>
            <span className="up-value">{props.length}</span>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/** The system database keeps `lastModified` as milliseconds; the original Designer shows a date. */
function formatStamp(value: string): string {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms < 1e11) return value
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
