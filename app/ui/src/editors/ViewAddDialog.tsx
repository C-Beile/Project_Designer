import { useState } from 'react'
import { Modal } from '../core/Modal'
import { acceptsEntityFields } from './viewFields'
import { Button, Dropdown, Input } from '../core/ui/controls'

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
          <Button variant="bare" isDisabled={!ready} onClick={submit}>
            OK
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <label className="forge-field">
        <span>What to add</span>
        <Dropdown value={what} aria-label="What to add" options={[{ id: "field", label: "Entity field" }, { id: "view", label: "View" }]} onChange={(v) => setWhat(v as 'field' | 'view')} />
      </label>
      {what === 'field' ? (
        <>
          <label className="forge-field">
            <span>Into the ViewTemplate</span>
            <Dropdown value={templateKey} aria-label="ViewTemplate" options={fieldTemplates.map((t) => ({ id: `${t.kind}|${t.name}`, label: `${t.name} (${t.kind.replace(/ViewTemplate$/, '')})` }))} onChange={(v) => setTemplateKey(v)} />
          </label>
          <label className="forge-field">
            <span>Entity field</span>
            {entityFields.length > 0 ? (
              <Dropdown value={field} aria-label="Entity field" options={entityFields.map((f) => ({ id: f, label: f }))} onChange={(v) => setField(v)} />
            ) : (
              <Input type="text" aria-label="Entity field" value={field} onChange={(e) => setField(e.target.value)} />
            )}
          </label>
        </>
      ) : (
        <>
          <label className="forge-field">
            <span>View</span>
            <Dropdown value={view} aria-label="View" options={views.map((v) => ({ id: v, label: v }))} onChange={(v) => setView(v)} />
          </label>
          <label className="forge-field">
            <span>Assigned to entity field</span>
            <Dropdown value={consumer} aria-label="Assigned to" options={[{ id: "#ENTITY", label: "#ENTITY (main data)" }, ...entityFields.map((f) => ({ id: f, label: f }))]} onChange={(v) => setConsumer(v)} />
          </label>
        </>
      )}
      <p className="forge-field-hint">Only what the real view files show is offered here. Adding a new ViewTemplate is not available: the original's Add dialog is not documented.</p>
    </Modal>
  )
}
