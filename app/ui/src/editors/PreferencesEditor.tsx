import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { EditorProps } from './registry'
import { field, textField, textValue } from '../wire/types'
import type { WireValue } from '../wire/types'
import { EditableText } from './EditableText'
import { PREFERENCES_DESCRIPTIONS } from './preferencesDescriptions.generated'
import { setCustomProperty, setTopLevelValue, shapeOfTag, type CustomBank, type PropertyShape } from './preferencesOps'
import { useSheetSplit } from '../properties/useSheetSplit'

// Project preferences drawn like the original Designer: groups with Name | Value rows. A click
// selects a row and shows its description below. A value that exists as text is written with the
// property write path; typed values (true/false, numbers) and values not set yet are written by
// editing the model text (see preferencesOps.ts). Top-level properties that are not in the file yet
// are shown but cannot be added here.

interface PrefProp {
  name: string
  label?: string
}

const PREF_GROUPS: { label: string; props: PrefProp[] }[] = [
  { label: 'System', props: [{ name: 'projectName', label: 'Project name' }, { name: 'defaultSystemAlias' }, { name: 'defaultDataAlias' }] },
  { label: 'JDito', props: [{ name: 'jditoUserServerContext' }, { name: 'jditoMaxContentSize' }] },
  { label: 'Recordcontainer Cache', props: [{ name: 'recordContainerCachingAlias' }, { name: 'maxEntryLifetimeInCache' }] },
  { label: 'Cluster Messaging Cache', props: [{ name: 'clusterMessagingAlias' }] },
  { label: 'Internationalisation', props: [{ name: 'multilingualismLocale' }, { name: 'multilingualismLocaleMappings' }, { name: 'multilingualismIndexSearchLocales' }] },
  { label: 'Navigation Bar', props: [{ name: 'helpLocation' }, { name: 'homeLocation' }] },
  { label: 'Userhelp', props: [{ name: 'ressourceDomain' }, { name: 'relativePathToRessources' }] },
  { label: 'Manager Backend', props: [{ name: 'managerBackendAlias' }] },
  { label: 'Message Queue', props: [{ name: 'messageQueueAlias' }] },
  { label: 'Content Analysis', props: [{ name: 'contentAnalysisAlias' }] },
  { label: 'PDF Preview Service', props: [{ name: 'pdfPreviewAlias' }] },
  { label: 'Text analysis service', props: [{ name: 'textAnalysisAlias' }] },
  {
    label: 'Other',
    props: [
      { name: 'mailRepositoryAlias', label: 'Mail repository alias' },
      { name: 'blobHandlingMethod', label: 'Blob handling method' },
      { name: 'databaseAuditProcessLoggerUser', label: 'Database audit process logger user' },
    ],
  },
]

interface Selected {
  key: string
  name: string
  description: string
}

export function PreferencesEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  const [source, setSource] = useState<{ text: string; read_only: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const { split, onPointerDown, onKeyDown, reset } = useSheetSplit('prefs', rowsRef)

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => api.getObjectSource(nodeId))
      .then((s) => !cancelled && setSource(s))
      .catch(() => !cancelled && setSource(null))
    return () => {
      cancelled = true
    }
  }, [api, nodeId, tree])
  const canEditSource = !!source && !source.read_only

  async function commitScalar(path: string, next: string) {
    try {
      setError(null)
      const updated = await api.setProperty(nodeId, path, textValue(next))
      onTreeChange(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function commitSource(compute: (text: string) => string | null) {
    if (!source || source.read_only) return
    const next = compute(source.text)
    if (next === null) {
      setError('This value does not fit the property (true or false, a whole number) or the property is not in the file.')
      return
    }
    try {
      setError(null)
      const outcome = await api.setObjectSource(nodeId, next)
      setSource({ text: next, read_only: false })
      onTreeChange(outcome.tree)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const name = textField(tree, 'name') ?? ''
  const select = (key: string, title: string, description: string) => setSelected({ key, name: title, description })

  return (
    <div className="preferences-editor sheet-editor" style={{ '--sheet-split': `${split}%` } as CSSProperties}>
      <h2>{name}</h2>
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sheet-scroll">
        <div className="sheet-rows" ref={rowsRef}>
          {PREF_GROUPS.map((group) => (
            <section key={group.label} className="sheet-group" aria-label={group.label}>
              <h3 className="sheet-group-head">{group.label}</h3>
              {group.props.map((p) => (
                <TopRow
                  key={p.name}
                  prop={p}
                  tree={tree}
                  selected={selected?.key === `top:${p.name}`}
                  canEditSource={canEditSource}
                  onSelect={() => select(`top:${p.name}`, p.name, PREFERENCES_DESCRIPTIONS[p.name] ?? '')}
                  onCommitText={(next) => commitScalar(p.name, next)}
                  onCommitTyped={(shape, next) => commitSource((text) => setTopLevelValue(text, p.name, shape, next))}
                />
              ))}
            </section>
          ))}
          <PropertyBank title="Custom properties" bank="customProperties" tree={tree} canEditSource={canEditSource} selectedKey={selected?.key ?? null} onSelect={select} onCommitText={commitScalar} onCommitSource={commitSource} />
          <PropertyBank title="Custom config properties" bank="customConfigProperties" tree={tree} canEditSource={canEditSource} selectedKey={selected?.key ?? null} onSelect={select} onCommitText={commitScalar} onCommitSource={commitSource} />
          <div
            className="sheet-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Column divider"
            aria-valuemin={15}
            aria-valuemax={85}
            aria-valuenow={Math.round(split)}
            tabIndex={0}
            title="Drag to resize the columns, double-click to reset"
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            onDoubleClick={reset}
          />
        </div>
      </div>
      <div className="sheet-desc" aria-label="Description" aria-live="polite">
        <strong>{selected?.name ?? name}</strong>
        {selected?.description ? <p>{selected.description}</p> : null}
      </div>
    </div>
  )
}

function topValue(tree: WireValue, name: string): { shape: PropertyShape | 'missing'; text: string } {
  const v = field(tree, name)
  if (!v) return { shape: 'missing', text: '' }
  if (v.kind === 'text') return { shape: 'text', text: v.value }
  if (v.kind === 'bool') return { shape: 'bool', text: String(v.value) }
  if (v.kind === 'int') return { shape: 'int', text: String(v.value) }
  return { shape: 'missing', text: '' }
}

function TopRow({
  prop,
  tree,
  selected,
  canEditSource,
  onSelect,
  onCommitText,
  onCommitTyped,
}: {
  prop: PrefProp
  tree: WireValue
  selected: boolean
  canEditSource: boolean
  onSelect: () => void
  onCommitText: (next: string) => void
  onCommitTyped: (shape: PropertyShape, next: string) => void
}) {
  const { shape, text } = topValue(tree, prop.name)
  const label = prop.label ?? prop.name
  const unset = shape === 'missing' || text === ''
  let control
  if (shape === 'missing') {
    control = <EditableText value="" ariaLabel={label} disabled title="Not set in this file. Adding a new top-level property is not supported yet." onCommit={() => {}} />
  } else if (shape === 'text') {
    control = <EditableText value={text} ariaLabel={label} onCommit={onCommitText} />
  } else if (shape === 'bool') {
    control = <input type="checkbox" aria-label={label} checked={text === 'true'} disabled={!canEditSource} onChange={(e) => onCommitTyped('bool', String(e.target.checked))} />
  } else {
    control = canEditSource ? (
      <EditableText value={text} ariaLabel={label} onCommit={(next) => onCommitTyped('int', next)} />
    ) : (
      <span className="pref-readonly" aria-label={`${label} (read-only)`}>
        {text}
      </span>
    )
  }
  return (
    <label className={`pref-row${selected ? ' is-selected' : ''}${unset ? ' is-unset' : ''}`} onClick={onSelect}>
      <span className="pref-name">{prop.name}</span>
      {control}
    </label>
  )
}

const CUSTOM_PROPERTY_TAGS = [
  'customBooleanProperty',
  'customStringProperty',
  'customIntegerProperty',
  'customPasswordProperty',
  'customJDitoProperty',
] as const

interface PropertyEntry {
  path: string
  tag: string
  index: number
  name: string
  description: string
  textValue: boolean
  valueText: string
  hasProperty: boolean
}

function PropertyBank({
  title,
  bank,
  tree,
  canEditSource,
  selectedKey,
  onSelect,
  onCommitText,
  onCommitSource,
}: {
  title: string
  bank: CustomBank
  tree: WireValue
  canEditSource: boolean
  selectedKey: string | null
  onSelect: (key: string, title: string, description: string) => void
  onCommitText: (path: string, next: string) => void
  onCommitSource: (compute: (text: string) => string | null) => void
}) {
  const entries = useMemo(() => propertyEntries(field(tree, bank), bank), [tree, bank])
  if (entries.length === 0) return null

  return (
    <section className="preferences-editor-bank sheet-group">
      <h3 className="sheet-group-head">{title}</h3>
      <table aria-label={title} className="sheet-table">
        <colgroup>
          <col className="col-name" />
          <col className="col-desc" />
          <col className="col-value" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const key = `${bank}:${entry.path}`
            const shape = shapeOfTag(entry.tag)
            const sourceEdit = (value: string) => onCommitSource((text) => setCustomProperty(text, bank, entry.tag, entry.index, value))
            const aria = `${title} ${i} value`
            const masked = entry.tag === 'customPasswordProperty'
            let control
            if (shape === 'bool' && canEditSource) {
              control = <input type="checkbox" aria-label={aria} checked={entry.valueText === 'true'} onChange={(e) => sourceEdit(String(e.target.checked))} />
            } else if (shape === 'bool') {
              control = (
                <span className="sheet-bool" aria-label={`${aria} (read-only)`}>
                  <input type="checkbox" checked={entry.valueText === 'true'} disabled tabIndex={-1} aria-hidden="true" />
                  <span className="forge-sr-only">{entry.valueText}</span>
                </span>
              )
            } else if (entry.textValue) {
              control = <EditableText value={entry.valueText} ariaLabel={aria} masked={masked} onCommit={(next) => onCommitText(`${entry.path}.property`, next)} />
            } else if (canEditSource) {
              control = <EditableText value={entry.valueText} ariaLabel={aria} masked={masked} onCommit={sourceEdit} />
            } else {
              control = <span aria-label={`${aria} (read-only)`}>{entry.valueText}</span>
            }
            return (
              <tr key={entry.path} className={selectedKey === key ? 'is-selected' : ''} onClick={() => onSelect(key, entry.name, entry.description)}>
                <td className={`sheet-name${entry.hasProperty ? '' : ' is-unset'}`}>{entry.name}</td>
                <td className="sheet-desc-cell">{entry.description}</td>
                <td className="sheet-value">{control}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

// Each of the five tags is either a single Object or an indexed Array; a bank can mix both.
function propertyEntries(bank: WireValue | undefined, bankFieldName: string): PropertyEntry[] {
  if (!bank) return []
  const entries: PropertyEntry[] = []
  for (const tag of CUSTOM_PROPERTY_TAGS) {
    const raw = field(bank, tag)
    if (!raw) continue
    if (raw.kind === 'array') {
      raw.items.forEach((item, i) => entries.push(toEntry(item, `${bankFieldName}.${tag}[${i}]`, tag, i)))
    } else if (raw.kind === 'object') {
      entries.push(toEntry(raw, `${bankFieldName}.${tag}`, tag, 0))
    }
  }
  return entries
}

function toEntry(item: WireValue, path: string, tag: string, index: number): PropertyEntry {
  const name = textField(item, 'name') ?? ''
  const description = textField(item, 'description') ?? ''
  const pv = field(item, 'property')
  const base = { path, tag, index, name, description }
  if (!pv) return { ...base, textValue: false, valueText: '', hasProperty: false }
  if (pv.kind === 'text') return { ...base, textValue: true, valueText: pv.value, hasProperty: pv.value !== '' }
  if (pv.kind === 'bool' || pv.kind === 'int') return { ...base, textValue: false, valueText: String(pv.value), hasProperty: true }
  return { ...base, textValue: false, valueText: '', hasProperty: false }
}
