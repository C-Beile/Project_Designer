import { useEffect, useMemo, useState } from 'react'
import type { AliasConfigDto } from '../wire/types'
import { isConfigurationAlias, sectionLabel, sectionSheet, useConfigSection, type SheetGroup } from './configSections'

// Property sheet of an alias config (original Designer, shots 83, 84, 98, 102544): type aliasConfig,
// one collapsible group per kind of property, Name | Value, unset values grey and italic, check
// boxes for yes/no values. The Properties panel and the config editor tab use this one component.
// `_____CONFIGURATION` follows the section picked in its Navigator and shows the section name in a
// description area below. The values come from the system database; passwords are masked and never
// reach the UI. Edits stay a draft: nothing is written to the system database until the confirmed
// write path with the deploy diff exists.

function plainGroups(config: AliasConfigDto): SheetGroup[] {
  return config.groups.map((g) => ({
    label: g.label,
    rows: g.props.map((p) => ({ name: p.name, value: p.value, secret: p.secret, set: p.value !== '' || p.secret, kind: 'text' as const })),
  }))
}

export function AliasConfigPanel({ config, system, editable = false }: { config: AliasConfigDto; system: string; editable?: boolean }) {
  const section = useConfigSection()
  const byConfig = isConfigurationAlias(config.name)
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => setDraft({}), [config.name, system])
  const sheet = useMemo(() => (byConfig ? sectionSheet(config, section) : { groups: plainGroups(config), defined: true }), [byConfig, config, section])
  const changes = Object.keys(draft).length
  return (
    <div className="forge-props alias-config-panel" aria-label={`${config.name} properties`}>
      {byConfig ? null : (
        <>
          <div className="forge-props-row">
            <span className="forge-props-name">name</span>
            <span className="forge-props-value">{config.name}</span>
          </div>
          <div className="forge-props-row">
            <span className="forge-props-name">type</span>
            <span className="forge-props-value">aliasConfig ({config.type_label})</span>
          </div>
          <div className="forge-props-row">
            <span className="forge-props-name">system</span>
            <span className="forge-props-value">{system}</span>
          </div>
        </>
      )}
      {sheet.groups.map((g) => (
        <details key={g.label} open className="alias-group">
          <summary className="alias-group-label">{g.label}</summary>
          {g.rows.map((r) => {
            const id = `${g.label}/${r.name}`
            const value = draft[id] ?? r.value
            const changed = id in draft
            const unset = !r.set && !changed
            return (
              <div key={r.name} className={`forge-props-row${changed ? ' is-draft' : ''}`}>
                <span className={`forge-props-name${unset ? ' is-unset' : ''}`}>{r.name}</span>
                {r.secret ? (
                  <span className="forge-props-value">{r.set ? '•'.repeat(12) : ''}</span>
                ) : r.kind === 'checkbox' ? (
                  <input
                    type="checkbox"
                    aria-label={r.name}
                    checked={value === 'true'}
                    disabled={!editable}
                    onChange={(e) => setDraft((d) => (String(e.target.checked) === r.value ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== id)) : { ...d, [id]: String(e.target.checked) }))}
                  />
                ) : editable ? (
                  <input
                    className="forge-props-input"
                    aria-label={r.name}
                    value={value}
                    list={r.kind === 'combo' ? `opts-${r.name}` : undefined}
                    onChange={(e) => setDraft((d) => (e.target.value === r.value ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== id)) : { ...d, [id]: e.target.value }))}
                  />
                ) : (
                  <span className={`forge-props-value${unset ? ' is-unset' : ''}`}>{value}</span>
                )}
                {r.kind === 'combo' ? <datalist id={`opts-${r.name}`}>{r.value ? <option value={r.value} /> : null}</datalist> : null}
              </div>
            )
          })}
        </details>
      ))}
      {byConfig && !sheet.defined ? <p className="forge-field-hint">The properties of this section are not known yet (needs a screenshot or the property list of the config).</p> : null}
      {changes > 0 ? (
        <p className="forge-field-hint" role="status">
          Draft: {changes} change{changes === 1 ? '' : 's'}, not written. Writing to the system database needs the confirmed write path with the deploy diff (not built).{' '}
          <button type="button" onClick={() => setDraft({})}>
            Discard
          </button>
        </p>
      ) : (
        <p className="forge-field-hint">{editable ? 'Changes stay a draft; nothing is written yet.' : 'Read-only: the values are not written back yet.'}</p>
      )}
      {byConfig ? (
        <div className="alias-config-desc" aria-label="Description">
          <strong>{sectionLabel(section)}</strong>
        </div>
      ) : null}
    </div>
  )
}
