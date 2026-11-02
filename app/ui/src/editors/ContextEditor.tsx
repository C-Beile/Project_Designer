import type { EditorProps } from './registry'
import { asArray, field, textField, textValue } from '../wire/types'
import { EditableText } from './EditableText'

// Ziel 2 (neonContext editor, P4 second family): "welche Entity, welche Views/Aktionen"
// (feature-matrix.md's MUST subset) - the context's own identity (`title`), its bound `entity`,
// its three primary view slots (`filterView`/`editView`/`previewView`), and the full
// `references` catalogue (`neonViewReference`/`webserviceReference`) it keeps in sync with those
// slots (aod-format.md §3's "redundant catalogue" note - also why
// `view_context_dashboard_validators::PrimaryViewNotCatalogedValidator` exists: a primary slot
// missing from this catalogue is a real, surfaced authoring warning, visible in the
// `DiagnosticsPanel` while editing here).

export function ContextEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const title = textField(tree, 'title') ?? ''
  const entity = textField(tree, 'entity') ?? ''
  const filterView = textField(tree, 'filterView') ?? ''
  const editView = textField(tree, 'editView') ?? ''
  const previewView = textField(tree, 'previewView') ?? ''

  const references = field(tree, 'references')
  const viewReferences = asArray(field(references, 'neonViewReference'))
  const webserviceReferences = asArray(field(references, 'webserviceReference'))

  return (
    <div className="context-editor">
      <h2>{name}</h2>

      <label>
        Title
        <EditableText value={title} ariaLabel="Context title" onCommit={(next) => commitScalar('title', next)} />
      </label>
      <label>
        Entity
        <EditableText value={entity} ariaLabel="Context entity" onCommit={(next) => commitScalar('entity', next)} />
      </label>
      <label>
        Filter view
        <EditableText
          value={filterView}
          ariaLabel="Context filter view"
          onCommit={(next) => commitScalar('filterView', next)}
        />
      </label>
      <label>
        Edit view
        <EditableText
          value={editView}
          ariaLabel="Context edit view"
          onCommit={(next) => commitScalar('editView', next)}
        />
      </label>
      <label>
        Preview view
        <EditableText
          value={previewView}
          ariaLabel="Context preview view"
          onCommit={(next) => commitScalar('previewView', next)}
        />
      </label>

      <table aria-label="Context view references">
        <thead>
          <tr>
            <th>Reference id</th>
            <th>View</th>
          </tr>
        </thead>
        <tbody>
          {viewReferences.map((reference, index) => {
            const refId = textField(reference, 'name') ?? ''
            const view = textField(reference, 'view') ?? ''
            return (
              <tr key={refId || index}>
                <td>{refId}</td>
                <td>
                  <EditableText
                    value={view}
                    ariaLabel={`View reference ${index} view`}
                    onCommit={(next) => commitScalar(`references.neonViewReference[${index}].view`, next)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <table aria-label="Context webservice references">
        <thead>
          <tr>
            <th>Reference id</th>
            <th>Webservice</th>
          </tr>
        </thead>
        <tbody>
          {webserviceReferences.map((reference, index) => {
            const refId = textField(reference, 'name') ?? ''
            const webservice = textField(reference, 'webservice') ?? ''
            return (
              <tr key={refId || index}>
                <td>{refId}</td>
                <td>
                  <EditableText
                    value={webservice}
                    ariaLabel={`Webservice reference ${index} webservice`}
                    onCommit={(next) => commitScalar(`references.webserviceReference[${index}].webservice`, next)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
