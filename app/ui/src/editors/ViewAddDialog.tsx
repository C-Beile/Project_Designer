import { useState } from 'react'
import { Modal } from '../core/Modal'
import { acceptsEntityFields } from './viewFields'

// "Add..." of the view preview: puts something into the open view. Two things are offered because
// the real view files show exactly how they look: an entity field in a template (as a field or a
// column) and a reference to another view. Which other things the original offers is not
// documented, so nothing else is offered.

export interface AddTemplate {
  kind: string
  name: string
}

export type AddChoice = { what: 'field'; template: AddTemplate; entityField: string } | { what: 'view'; view: string; entityField: string }

export function ViewAddDialog({
  templates,
  initialTemplate,
  entityFields,
  views,
  onClose,
  onAdd,
}: {
  templates: AddTemplate[]
  initialTemplate: AddTemplate | null
  /** Names of the entity fields of the view's context. */
  entityFields: string[]
  views: string[]
  onClose: () => void
  onAdd: (choice: AddChoice) => void
}) {
  const fieldTemplates = templates.filter((t) => acceptsEntityFields(t.kind))
  const [what, setWhat] = useState<'field' | 'view'>(fieldTemplates.length > 0 ? 'field' : 'view')
  const [templateKey, setTemplateKey] = useState(() => {
    const first = initialTemplate && fieldTemplates.some((t) => t.kind === initialTemplate.kind && t.name === initialTemplate.name) ? initialTemplate : fieldTemplates[0]
    return first ? `${first.kind}|${first.name}` : ''
  })
  const [field, setField] = useState(entityFields[0] ?? '')
  const [view, setView] = useState(views[0] ?? '')
  const [consumer, setConsumer] = useState('#ENTITY')

  const template = fieldTemplates.find((t) => `${t.kind}|${t.name}` === templateKey)
  const ready = what === 'field' ? !!template && field.trim() !== '' : view !== '' && consumer.trim() !== ''

  function submit() {
    if (!ready) return
    if (what === 'field' && template) onAdd({ what: 'field', template, entityField: field.trim() })
    else onAdd({ what: 'view', view, entityField: consumer.trim() })
  }

  return (
    <Modal
      title="Add"
      onClose={onClose}
      onEnter={submit}
      footer={
        <>
          <button type="button" disabled={!ready} onClick={submit}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <label className="forge-field">
        <span>What to add</span>
        <select aria-label="What to add" value={what} onChange={(e) => setWhat(e.target.value as 'field' | 'view')}>
          <option value="field" disabled={fieldTemplates.length === 0}>
            Entity field
          </option>
          <option value="view">View</option>
        </select>
      </label>
      {what === 'field' ? (
        <>
          <label className="forge-field">
            <span>Into the ViewTemplate</span>
            <select aria-label="ViewTemplate" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              {fieldTemplates.map((t) => (
                <option key={`${t.kind}|${t.name}`} value={`${t.kind}|${t.name}`}>
                  {`${t.name} (${t.kind.replace(/ViewTemplate$/, '')})`}
                </option>
              ))}
            </select>
          </label>
          <label className="forge-field">
            <span>Entity field</span>
            {entityFields.length > 0 ? (
              <select aria-label="Entity field" value={field} onChange={(e) => setField(e.target.value)}>
                {entityFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" aria-label="Entity field" value={field} onChange={(e) => setField(e.target.value)} />
            )}
          </label>
        </>
      ) : (
        <>
          <label className="forge-field">
            <span>View</span>
            <select aria-label="View" value={view} onChange={(e) => setView(e.target.value)}>
              {views.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="forge-field">
            <span>Assigned to entity field</span>
            <select aria-label="Assigned to" value={consumer} onChange={(e) => setConsumer(e.target.value)}>
              <option value="#ENTITY">#ENTITY (main data)</option>
              {entityFields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <p className="forge-field-hint">Only what the real view files show is offered here. Adding a new ViewTemplate is not available: the original's Add dialog is not documented.</p>
    </Modal>
  )
}
