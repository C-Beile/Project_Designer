import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { UserPropertyDto } from '../wire/types'
import { confirmDialog } from '../shell/dialogService'
import { notifyUsersChanged, type UserSelection } from './userSelection'

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
const READ_ONLY_KEYS = new Set(['lastmodified', 'name'])

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
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setProps(null)
    setEdits({})
    setError(null)
    void (async () => {
      await api.dbActivate(systemKey).catch(() => false)
      return api.systemUserProperties(user)
    })()
      .then((p) => !cancelled && setProps(p))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [api, user, systemKey, tick])

  const byKey = useMemo(() => fieldsByKey(props ?? []), [props])
  const changed = (props ?? []).filter((p) => p.editable && edits[p.id] !== undefined && edits[p.id] !== (p.value ?? ''))

  async function save() {
    if (changed.length === 0) return
    const lines = changed.map((p) => `${p.key}: "${p.value ?? ''}" -> "${edits[p.id]}"`).join(String.fromCharCode(10))
    const nl = String.fromCharCode(10)
    const yes = await confirmDialog(`Write ${changed.length} change${changed.length === 1 ? '' : 's'} of ${selection.title || user} into the system database of ${systemName}?${nl}${nl}${lines}`, { title: 'Save user', okLabel: 'Save' })
    if (!yes) return
    setSaving(true)
    setError(null)
    try {
      await api.dbActivate(systemKey).catch(() => false)
      for (const p of changed) await api.systemUserSetProperty(p.id, edits[p.id], true)
      notifyUsersChanged()
      setTick((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const row = (key: string) => {
    const field = byKey.get(key.toLowerCase())
    const lower = key.toLowerCase()
    const rows = field?.rows ?? []
    const secret = rows.some((r) => !r.editable) || lower === 'password' || lower === 'passwordhistory'
    if (secret) {
      return (
        <div className="up-row" key={key}>
          <span className={`up-name${rows.length ? '' : ' is-unset'}`}>{key}</span>
          <span className="up-value">{rows.length ? '***' : ''}</span>
        </div>
      )
    }
    if (rows.length > 1) {
      return (
        <div className="up-row" key={key}>
          <span className="up-name">{key}</span>
          <span className="up-value" title={rows.map((r) => r.value ?? '').join(', ')}>
            [{rows.map((r) => r.value ?? '').join(', ')}]
          </span>
        </div>
      )
    }
    const p = rows[0]
    const readOnly = !p || READ_ONLY_KEYS.has(lower)
    const current = p ? (edits[p.id] ?? p.value ?? '') : ''
    const isChanged = !!p && edits[p.id] !== undefined && edits[p.id] !== (p.value ?? '')
    return (
      <div className={`up-row${isChanged ? ' is-changed' : ''}`} key={key}>
        <span className={`up-name${p ? '' : ' is-unset'}`}>{key}</span>
        {BOOLEANS.has(lower) && p ? (
          <input type="checkbox" aria-label={key} checked={current.toLowerCase() === 'true'} onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.checked ? 'true' : 'false' }))} />
        ) : (
          <input
            type="text"
            aria-label={key}
            value={lower === 'lastmodified' && current ? formatStamp(current) : current}
            readOnly={readOnly}
            title={!p ? 'Not set for this user' : undefined}
            onChange={(e) => p && setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
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
          <button type="button" className="is-primary" disabled={changed.length === 0 || saving} onClick={() => void save()}>
            {saving ? 'Saving...' : `Save${changed.length ? ` (${changed.length})` : ''}`}
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
