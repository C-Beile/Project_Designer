import type { EditorProps } from './registry'
import { field, textField, textValue } from '../wire/types'
import type { WireValue } from '../wire/types'
import { EditableText } from './EditableText'

// P4 fifth family, part 2/3 (`PreferencesEditor`): the MUST subset of feature-matrix.md's
// PreferencesEditor entry - a single project-wide `preferences/_____PREFERENCES_PROJECT/
// _____PREFERENCES_PROJECT.aod` (real Hermes instance: 443 lines, see
// p4-editor-system-preferences-application-notes.md §1). The real file is large; this editor
// exposes four genuinely editable top-level plain-text scalars (chosen for real operational
// relevance, not arbitrarily) plus the two "custom property bank" lists
// (`customProperties`/`customConfigProperties`) that make up most of the file's real content. Many
// other real top-level fields are typed `v="..."` scalars (booleans/ints) - out of this round's
// MUST scope, same R24 (RISKS.md) read-only precedent every prior family already established for
// typed attributes (`aod-io`'s write-back path only supports Text-content scalars).
export function PreferencesEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const projectName = textField(tree, 'projectName') ?? ''
  const mailRepositoryAlias = textField(tree, 'mailRepositoryAlias') ?? ''
  const blobHandlingMethod = textField(tree, 'blobHandlingMethod') ?? ''
  const databaseAuditProcessLoggerUser = textField(tree, 'databaseAuditProcessLoggerUser') ?? ''

  return (
    <div className="preferences-editor">
      <h2>{name}</h2>
      <label>
        Project name
        <EditableText value={projectName} ariaLabel="Project name" onCommit={(next) => commitScalar('projectName', next)} />
      </label>
      <label>
        Mail repository alias
        <EditableText
          value={mailRepositoryAlias}
          ariaLabel="Mail repository alias"
          onCommit={(next) => commitScalar('mailRepositoryAlias', next)}
        />
      </label>
      <label>
        Blob handling method
        <EditableText
          value={blobHandlingMethod}
          ariaLabel="Blob handling method"
          onCommit={(next) => commitScalar('blobHandlingMethod', next)}
        />
      </label>
      <label>
        Database audit process logger user
        <EditableText
          value={databaseAuditProcessLoggerUser}
          ariaLabel="Database audit process logger user"
          onCommit={(next) => commitScalar('databaseAuditProcessLoggerUser', next)}
        />
      </label>

      <PropertyBank title="Custom properties" bankFieldName="customProperties" tree={tree} onCommit={commitScalar} />
      <PropertyBank
        title="Custom config properties"
        bankFieldName="customConfigProperties"
        tree={tree}
        onCommit={commitScalar}
      />
    </div>
  )
}

// The five real custom-property element tag names observed under both `customProperties` and
// `customConfigProperties` in the real Hermes fixture (mirrors
// `preferences_validators.rs::CUSTOM_PROPERTY_TAGS`).
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
  name: string
  description: string
  editable: boolean
  valueText: string
}

function PropertyBank({
  title,
  bankFieldName,
  tree,
  onCommit,
}: {
  title: string
  bankFieldName: string
  tree: WireValue
  onCommit: (path: string, next: string) => void
}) {
  const bank = field(tree, bankFieldName)
  const entries = propertyEntries(bank, bankFieldName)

  if (entries.length === 0) return null

  return (
    <section className="preferences-editor-bank">
      <h3>{title}</h3>
      <table aria-label={title}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.path}>
              <td>{entry.name}</td>
              <td>{entry.description}</td>
              <td>
                {entry.editable ? (
                  <EditableText
                    value={entry.valueText}
                    ariaLabel={`${title} ${i} value`}
                    onCommit={(next) => onCommit(`${entry.path}.property`, next)}
                  />
                ) : (
                  <span aria-label={`${title} ${i} value (read-only)`}>{entry.valueText}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Every one of the five tags independently is either a plain Object (exactly one real occurrence,
// R26/RISKS.md - e.g. the real fixture's `customConfigProperties.customIntegerProperty`, a single
// `bulkmail.dateToSendPassedAfter` entry) or an indexed Array (2+ occurrences) -
// `core-model`'s real projector (`aod_io_adapter::group_children`) groups same-tag siblings
// independently per tag name, so a single property bank can mix both shapes across its five tags at
// once. This walks all five, handling each shape uniformly (same precedent
// `LanguageEditor.tsx::stringEntries` established for one tag; extended here to five, see
// `preferences_validators.rs`'s module doc for the full real-corpus evidence).
function propertyEntries(bank: WireValue | undefined, bankFieldName: string): PropertyEntry[] {
  if (!bank) return []
  const entries: PropertyEntry[] = []

  for (const tag of CUSTOM_PROPERTY_TAGS) {
    const raw = field(bank, tag)
    if (!raw) continue

    if (raw.kind === 'array') {
      raw.items.forEach((item, i) => entries.push(toEntry(item, `${bankFieldName}.${tag}[${i}]`, tag)))
    } else if (raw.kind === 'object') {
      entries.push(toEntry(raw, `${bankFieldName}.${tag}`, tag))
    }
  }
  return entries
}

// A `customStringProperty`/`customPasswordProperty`/`customJDitoProperty`'s `<property>` is a
// plain text-content scalar (editable); a `customBooleanProperty`/`customIntegerProperty`'s is the
// typed `v="..."` attribute form (read-only, R24 - `aod-io`'s write-back path does not support it
// yet). Read the wire value's own `kind` rather than branching on `tag` so a property with no
// `<property>` element at all (a declared-but-unset custom property, real in the fixture, e.g.
// `AD.technicalUserDN`) renders as an empty read-only cell instead of crashing.
function toEntry(item: WireValue, path: string, tag: string): PropertyEntry {
  const name = textField(item, 'name') ?? ''
  const description = textField(item, 'description') ?? ''
  const propertyValue = field(item, 'property')

  if (!propertyValue) {
    return { path, tag, name, description, editable: false, valueText: '' }
  }
  if (propertyValue.kind === 'text') {
    return { path, tag, name, description, editable: true, valueText: propertyValue.value }
  }
  if (propertyValue.kind === 'bool') {
    return { path, tag, name, description, editable: false, valueText: String(propertyValue.value) }
  }
  if (propertyValue.kind === 'int') {
    return { path, tag, name, description, editable: false, valueText: String(propertyValue.value) }
  }
  return { path, tag, name, description, editable: false, valueText: '' }
}
