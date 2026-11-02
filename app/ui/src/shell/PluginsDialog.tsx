import { useState, useSyncExternalStore } from 'react'
import { Modal } from './Dialogs'
import { PLUGINS, getPluginPrefs, pluginState, setPluginPrefs, subscribePluginPrefs, type PluginInfo } from '../settings/plugins'

// Tools > Plugins (manual 14.1, screenshot 202): tabs Updates, Available Plugins, Downloaded,
// Installed (n) and Settings. Vendira's plugins are built-in components, so there is no catalog and
// no nbm import; the Installed tab shows what exists and what is still missing.

type Tab = 'updates' | 'available' | 'downloaded' | 'installed' | 'settings'

const TAB_LABEL: Record<Tab, string> = {
  updates: 'Updates',
  available: 'Available Plugins',
  downloaded: 'Downloaded',
  installed: 'Installed',
  settings: 'Settings',
}

function StateDot({ state }: { state: ReturnType<typeof pluginState> }) {
  const label = state === 'active' ? 'Active' : state === 'deactivated' ? 'Deactivated' : 'Not implemented'
  return (
    <span className={`forge-plugin-dot is-${state}`} role="img" aria-label={label} title={label}>
      {state === 'active' ? '✔' : state === 'deactivated' ? '■' : '●'}
    </span>
  )
}

export function PluginsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useSyncExternalStore(subscribePluginPrefs, getPluginPrefs)
  const [tab, setTab] = useState<Tab>('installed')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>(PLUGINS[0].id)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const needle = search.trim().toLowerCase()
  const list = PLUGINS.filter((p) => !needle || `${p.name} ${p.category}`.toLowerCase().includes(needle))
  const current: PluginInfo = PLUGINS.find((p) => p.id === selected) ?? PLUGINS[0]
  const state = pluginState(current, prefs)
  const marked = PLUGINS.filter((p) => checked.has(p.id))
  const canToggle = (p: PluginInfo, to: 'activate' | 'deactivate') => {
    const s = pluginState(p, prefs)
    return p.switchable && (to === 'deactivate' ? s === 'active' : s === 'deactivated')
  }
  const targets = marked.length > 0 ? marked : [current]

  function apply(to: 'activate' | 'deactivate') {
    const ids = targets.filter((p) => canToggle(p, to)).map((p) => p.id)
    if (ids.length === 0) return
    const rest = prefs.deactivated.filter((id) => !ids.includes(id))
    setPluginPrefs({ ...prefs, deactivated: to === 'deactivate' ? [...rest, ...ids] : rest })
  }

  return (
    <Modal
      title="Plugins"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" disabled title="No help pages yet">
            Help
          </button>
        </>
      }
    >
      <div className="forge-plugins">
        <div className="forge-opt-pages" role="tablist" aria-label="Plugin views">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`forge-opt-page${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
              {t === 'installed' ? `Installed (${PLUGINS.length})` : TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {tab === 'updates' ? <p className="forge-field-hint forge-plugins-note">All installed plugins are up to date. Vendira plugins are part of the application and are updated with it.</p> : null}
        {tab === 'available' ? <p className="forge-field-hint forge-plugins-note">There is no online plugin catalog for Vendira Designer. Components that are not implemented yet are listed as dimmed entries under Installed.</p> : null}
        {tab === 'downloaded' ? (
          <div className="forge-plugins-note">
            <button type="button" disabled>
              Add Plugins…
            </button>
            <p className="forge-field-hint">nbm files of the original Designer cannot be loaded: Vendira Designer has no NetBeans plugin loader.</p>
          </div>
        ) : null}
        {tab === 'settings' ? (
          <div className="forge-plugins-note">
            <label className="forge-opt-row">
              <span className="forge-opt-label">Source</span>
              <span className="forge-opt-control">
                <input type="text" readOnly value="Built into Vendira Designer" aria-label="Plugin source" />
              </span>
            </label>
            <label className="forge-opt-row">
              <span className="forge-opt-label">Check for updates</span>
              <span className="forge-opt-control">
                <select aria-label="Check frequency" value={prefs.checkFrequency} onChange={(e) => setPluginPrefs({ ...prefs, checkFrequency: e.target.value as typeof prefs.checkFrequency })}>
                  <option value="startup">Every startup</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                  <option value="never">Never</option>
                </select>
              </span>
            </label>
            <p className="forge-field-hint">Stored for later; there is no plugin catalog to check yet.</p>
          </div>
        ) : null}
        {tab === 'installed' ? (
          <div className="forge-plugins-split">
            <div className="forge-plugins-list">
              <div className="forge-plugins-search">
                <label>
                  <span>Search</span> <input type="text" aria-label="Search plugins" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </div>
              <table aria-label="Installed plugins">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const st = pluginState(p, prefs)
                    return (
                      <tr key={p.id} className={`${p.id === selected ? 'is-selected' : ''}${st === 'missing' ? ' is-missing' : ''}`} onClick={() => setSelected(p.id)}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={checked.has(p.id)}
                            onChange={(e) =>
                              setChecked((c) => {
                                const next = new Set(c)
                                if (e.target.checked) next.add(p.id)
                                else next.delete(p.id)
                                return next
                              })
                            }
                          />
                        </td>
                        <td>{p.name}</td>
                        <td>{p.category}</td>
                        <td>
                          <StateDot state={st} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="forge-plugins-actions">
                <button type="button" disabled={!targets.some((p) => canToggle(p, 'activate'))} onClick={() => apply('activate')}>
                  Activate
                </button>
                <button type="button" disabled={!targets.some((p) => canToggle(p, 'deactivate'))} onClick={() => apply('deactivate')}>
                  Deactivate
                </button>
                <button type="button" disabled title="Plugins are built into the application">
                  Uninstall
                </button>
              </div>
            </div>
            <div className="forge-plugins-detail" aria-label="Plugin details">
              <h3>{current.name}</h3>
              <p>
                <strong>Version:</strong> {current.version}
                <br />
                <strong>Author:</strong> {current.author}
                <br />
                <strong>State:</strong> {state === 'active' ? 'active' : state === 'deactivated' ? 'deactivated by you' : 'not implemented yet'}
              </p>
              <h4>Plugin Description</h4>
              <p>{current.description}</p>
              {current.notes.map((n) => (
                <p key={n} className="forge-field-hint">
                  {n}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
