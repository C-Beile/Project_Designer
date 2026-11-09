import type { EditorProps } from './registry'
import { field, textField, textValue } from '../wire/types'
import type { WireValue } from '../wire/types'
import { EditableText } from './EditableText'
import { useEffect, useState } from 'react'
import { useProjectIndex } from './projectIndex'

// `WebserviceEditor`: the MUST subset of feature-matrix.md's WebserviceEditor
// entry. Own mini format analysis this agent ran (no P1 `webservice.schema.json` existed) - object folder is `entityWebservice` (NOT `webservice`,
// despite aod-format.md §4's `webserviceReference.webservice` reference-type name), root element
// `entityWebservice`. `name`/`majorModelMode` shown read-only (identity/constant, same precedent
// `LanguageEditor.tsx`/`SystemEditor.tsx` set). `webserviceMethods`/`loginTypeId` are shown
// read-only (fixed-vocabulary token lists - HTTP verbs / auth-type ids - editing free text here
// would not respect that vocabulary, and `forge_core::ProjectHandle::set_property` cannot
// insert/delete a list entry anyway, the same structural-edit limitation every prior family
// documents). `jditoWebserviceUser`/`writeProvider`/`readProvider` are the genuinely editable
// plain-text scalars - editable only where the real file already declares them (verified: some
// real instances, e.g. `THHIT_PersonUpdate_ws`, omit all three entirely - same "editable only
// where the document already has the element" precedent `ApplicationEditor.tsx` sets for
// `title`/`icon`). `webserviceFields` (the list of published entity fields, mixing leaf
// `webserviceField` and nested `webserviceFieldConsumer` entries) is rendered read-only as a tree -
// `webserviceFieldName`/`consumer` are references to real entity fields/consumers, the same
// "key is an identity, not free text" precedent `LanguageEditor.tsx`/`ApplicationEditor.tsx` set for
// `name`.
export function WebserviceEditor({ nodeId, projectRoot, tree, api, onTreeChange }: EditorProps) {
  const index = useProjectIndex()
  const [entityFields, setEntityFields] = useState<{ entity: string; names: string[] } | null>(null)
  const serviceName = textField(tree, 'name') ?? ''
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!index || !serviceName) return
      const usages = await api.findUsages(projectRoot, 'entityWebservice', serviceName).catch(() => [])
      for (const usage of usages.filter((u) => u.object_type === 'neonContext')) {
        const context = index.findObject('neonContext', usage.object)
        if (!context) continue
        const entityName = textField(await api.getPropertyTree(context.id), 'entity')
        const entity = entityName ? index.findObject('entity', entityName) : null
        if (!entity || !entityName) continue
        const names = entityFieldNames(await api.getPropertyTree(entity.id))
        if (!cancelled) setEntityFields({ entity: entityName, names })
        return
      }
    }
    void load().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, index, projectRoot, serviceName])

  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const majorModelMode = textField(tree, 'majorModelMode') ?? ''
  const methods = stringListField(tree, 'webserviceMethods')
  const loginTypes = stringListField(tree, 'loginTypeId')
  const jditoWebserviceUser = textField(tree, 'jditoWebserviceUser')
  const writeProvider = textField(tree, 'writeProvider')
  const readProvider = textField(tree, 'readProvider')
  const topFields = webserviceFieldEntries(field(tree, 'webserviceFields'))

  return (
    <div className="webservice-editor">
      <h2>{name}</h2>
      <p className="webservice-editor-meta">
        Model mode: <code>{majorModelMode}</code>
      </p>

      <section>
        <h3>HTTP methods</h3>
        {methods.length > 0 ? (
          <ul className="webservice-methods">
            {methods.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="webservice-editor-warning">No HTTP method published - this endpoint answers no request.</p>
        )}
      </section>

      {loginTypes.length > 0 && (
        <section>
          <h3>Login types</h3>
          <ul className="webservice-login-types">
            {loginTypes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      {jditoWebserviceUser !== undefined && (
        <label>
          JDito webservice user
          <EditableText
            value={jditoWebserviceUser}
            ariaLabel="JDito webservice user"
            onCommit={(next) => commitScalar('jditoWebserviceUser', next)}
          />
        </label>
      )}
      {writeProvider !== undefined && (
        <label>
          Write provider
          <EditableText value={writeProvider} ariaLabel="Write provider" onCommit={(next) => commitScalar('writeProvider', next)} />
        </label>
      )}
      {readProvider !== undefined && (
        <label>
          Read provider
          <EditableText value={readProvider} ariaLabel="Read provider" onCommit={(next) => commitScalar('readProvider', next)} />
        </label>
      )}

      <div className="webservice-panes">
        <section className="webservice-pane" aria-label="Entity Fields">
          <h3>Entity Fields{entityFields ? ` (${entityFields.entity})` : ''}</h3>
          {entityFields ? (
            <ul className="webservice-fields-tree">
              {entityFields.names.map((n) => (
                <li key={n} className="webservice-field-leaf">
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="webservice-editor-meta">The entity is found through the context that references this webservice.</p>
          )}
        </section>
        <section className="webservice-pane" aria-label="Webservice Fields">
          <h3>Webservice Fields</h3>
          {topFields.length > 0 ? (
            <ul className="webservice-fields-tree">
              {topFields.map((entry) => (
                <WebserviceFieldNode key={entry.path} entry={entry} />
              ))}
            </ul>
          ) : (
            <p>No fields published.</p>
          )}
        </section>
      </div>
    </div>
  )
}

// `webserviceMethods.element`/`loginTypeId.element` independently hit the real R26 shape (RISKS.md)
// this object type has - a single real token projects as an un-indexed `element` (plain scalar),
// 2+ as an indexed `element[N]` array (see `webservice_validators.rs`'s module doc for the full
// real-corpus evidence). Handling both uniformly here is what makes a `THHIT_Tour_ws`-shaped single
// method/login-type actually render instead of silently disappearing.
function stringListField(tree: WireValue, listKey: string): string[] {
  const list = field(tree, listKey)
  if (!list) return []
  const raw = field(list, 'element')
  if (!raw) return []
  if (raw.kind === 'array') return raw.items.filter((item) => item.kind === 'text').map((item) => (item as { kind: 'text'; value: string }).value)
  if (raw.kind === 'text') return [raw.value]
  return []
}

interface WebserviceFieldRef {
  path: string
  kind: 'field' | 'consumer'
  value: WireValue
}

// Same real R26 shape as `stringListField` above, but for a *mixed*-tag list: `webserviceFields`
// holds `webserviceField` (leaf) and `webserviceFieldConsumer` (recursive, its own nested
// `webserviceFields`) side by side, and `group_children` (aod::tree) collapses each tag name to
// Object-vs-Array independently of the other - the same "one tag Array, a different tag in the same
// list stays an Object" shape `preferences`'s custom property banks established.
// `THHIT_PersonUpdate_ws`'s single real
// `webserviceField` (no `[0]`) is the minimal real example this must not drop.
function webserviceFieldEntries(container: WireValue | undefined): WebserviceFieldRef[] {
  if (!container) return []
  const entries: WebserviceFieldRef[] = []

  const rawFields = field(container, 'webserviceField')
  if (rawFields?.kind === 'array') {
    rawFields.items.forEach((item, i) => entries.push({ path: `webserviceField[${i}]`, kind: 'field', value: item }))
  } else if (rawFields?.kind === 'object') {
    entries.push({ path: 'webserviceField', kind: 'field', value: rawFields })
  }

  const rawConsumers = field(container, 'webserviceFieldConsumer')
  if (rawConsumers?.kind === 'array') {
    rawConsumers.items.forEach((item, i) => entries.push({ path: `webserviceFieldConsumer[${i}]`, kind: 'consumer', value: item }))
  } else if (rawConsumers?.kind === 'object') {
    entries.push({ path: 'webserviceFieldConsumer', kind: 'consumer', value: rawConsumers })
  }

  return entries
}

function WebserviceFieldNode({ entry }: { entry: WebserviceFieldRef }) {
  if (entry.kind === 'field') {
    const fieldName = textField(entry.value, 'webserviceFieldName') ?? ''
    return <li className="webservice-field-leaf">{fieldName}</li>
  }

  const consumerName = textField(entry.value, 'consumer') ?? ''
  const children = webserviceFieldEntries(field(entry.value, 'webserviceFields'))

  return (
    <li>
      <span className="webservice-field-consumer">{consumerName}</span>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <WebserviceFieldNode key={`${entry.path}.${child.path}`} entry={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Names of the fields an entity offers, in file order (providers, consumers and plain fields). */
function entityFieldNames(entityTree: WireValue): string[] {
  const container = field(entityTree, 'entityFields')
  if (!container || container.kind !== 'object') return []
  const names: string[] = []
  for (const f of container.fields) {
    const items = f.value.kind === 'array' ? f.value.items : [f.value]
    for (const item of items) {
      const name = textField(item, 'name')
      if (name) names.push(name)
    }
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
