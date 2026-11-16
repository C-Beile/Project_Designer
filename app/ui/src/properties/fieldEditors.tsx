import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { registerFieldAction, registerFieldEditor, type FieldContext } from '../core/contrib/fieldEditors'
import { TunnelGlyph } from '../tree/TunnelGlyph'
import { IconCombo } from './IconCombo'
import { CONFIG_PATH_ROWS, isIconRow, isImageRow, textOf } from './rowValues'
import { Button, Dropdown, Input } from '../core/ui/controls'

// Die eingebauten Wertdarstellungen des Properties-Panels. Ein Plugin hängt eigene mit
// `registerFieldEditor` / `registerFieldAction` (core/contrib/fieldEditors.ts) an.

function BoolEditor({ ctx }: { ctx: FieldContext }) {
  const { row } = ctx
  const checked = row.value?.kind === 'bool' ? row.value.value : textOf(row.value) === 'true'
  return <Input type="checkbox" aria-label={row.name} checked={checked} disabled={!ctx.canEdit} title={ctx.canEdit ? undefined : row.reason} onChange={(e) => ctx.commit({ kind: 'bool', value: e.target.checked })} />
}

function Choices({ ctx, values, goTo }: { ctx: FieldContext; values: string[]; goTo: boolean }) {
  const { row } = ctx
  const disabled = !ctx.canEdit
  const title = ctx.canEdit ? undefined : row.reason
  const shown = goTo && row.display && !values.includes(row.display) ? [row.display, ...values] : values
  return (
    <span className="psheet-ref">
      <Dropdown value={row.display} aria-label={row.name} title={title} isDisabled={disabled} options={[{ id: "", label: '' }, ...shown.map((v) => ({ id: v, label: v }))]} onChange={(v) => ctx.commit({ kind: 'text', value: v })} />
      {values.length > 8 && !disabled ? (
        <Button variant="bare" className="psheet-btn" aria-label={`Search ${row.name}`} title="Search the list (* is a wildcard)" onClick={ctx.search}>
          ⌕
        </Button>
      ) : null}
      {goTo ? (
        <Button variant="bare" className="psheet-btn" aria-label={`Go to ${row.display || row.name}`} title="Go to object" isDisabled={!row.display} onClick={ctx.goTo}>
          ➜
        </Button>
      ) : null}
    </span>
  )
}

function EnumEditor({ ctx }: { ctx: FieldContext }) {
  return <Choices ctx={ctx} values={ctx.row.enum_values ?? []} goTo={false} />
}

function ReferenceEditor({ ctx }: { ctx: FieldContext }) {
  return <Choices ctx={ctx} values={ctx.options} goTo />
}

function LinkedEditor({ ctx }: { ctx: FieldContext }) {
  const { row } = ctx
  const canOpen = row.set || !!row.new_reference
  return (
    <span className="psheet-linked" onDoubleClick={() => canOpen && ctx.openLinked()}>
      <span className="psheet-text" title={row.set ? row.display : 'Not set - double-click or use "..." to write the code'}>
        {row.display}
      </span>
      <Button variant="bare" className="psheet-btn" aria-label={`Open ${row.name}`} title={row.set ? 'Open the code in an editor tab' : 'Create and edit the code of this property'} isDisabled={!canOpen} onClick={ctx.openLinked}>
        …
      </Button>
    </span>
  )
}

function ListEditor({ ctx }: { ctx: FieldContext }) {
  const { row } = ctx
  const title = ctx.canEdit ? undefined : row.reason
  return (
    <span className="psheet-linked">
      <span className="psheet-text" title={title}>
        {row.display}
      </span>
      <Button variant="bare" className="psheet-btn" aria-label={`Show ${row.name}`} title={title} isDisabled={!row.set} onClick={ctx.openList}>
        …
      </Button>
    </span>
  )
}

function TextEditor({ ctx }: { ctx: FieldContext }) {
  const { row } = ctx
  const [draft, setDraft] = useState(row.display)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => setDraft(row.display), [row.display])

  const commit = () => {
    if (draft === row.display) return
    if (row.kind === 'int') {
      const n = Number(draft)
      if (!Number.isInteger(n)) {
        setDraft(row.display)
        return
      }
      ctx.commit({ kind: 'int', value: n })
      return
    }
    ctx.commit({ kind: 'text', value: draft })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setDraft(row.display)
    }
  }

  return <Input ref={ref} type="text" className="psheet-input" aria-label={row.name} value={draft} readOnly={!ctx.canEdit} title={ctx.canEdit ? undefined : row.reason} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
}

function IconEditor({ ctx }: { ctx: FieldContext }) {
  return <IconCombo api={ctx.api} value={ctx.row.display} disabled={!ctx.canEdit} onCommit={(id) => ctx.commit({ kind: 'text', value: id })} />
}

function ChooseButton({ ctx, title, disabled, onClick }: { ctx: FieldContext; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="bare" className="psheet-btn" aria-label={`Choose ${ctx.row.name}`} title={title} isDisabled={disabled} onClick={onClick}>
      {'…'}
    </Button>
  )
}

function ImageAction({ ctx }: { ctx: FieldContext }) {
  return <ChooseButton ctx={ctx} title="Choose the image file in the file explorer" disabled={!ctx.canEdit} onClick={ctx.browseImage} />
}

function IconAction({ ctx }: { ctx: FieldContext }) {
  return <ChooseButton ctx={ctx} title="Choose the icon from the icon chooser" disabled={!ctx.canEdit} onClick={ctx.pickIcon} />
}

function ConfigAction({ ctx }: { ctx: FieldContext }) {
  const { row } = ctx
  return (
    <>
      <ChooseButton ctx={ctx} title="Choose the file in the file explorer; it is copied into the project (others/cloud) and replaces an older copy" disabled={!ctx.hasProject} onClick={ctx.browseConfig} />
      <Button variant="bare" className="psheet-btn psheet-pencil" aria-label={`Edit ${row.name}`} title={row.name === 'tunnelConfigPath' ? 'Open the tunnel manager' : 'Open the server config file'} isDisabled={!row.display} onClick={ctx.editConfig}>
        {row.name === 'tunnelConfigPath' ? <TunnelGlyph /> : '✎'}
      </Button>
    </>
  )
}

/** Meldet die eingebauten Editoren an (Name vor Art, Text als Auffangnetz). Mehrfaches Aufrufen schadet nicht. */
export function registerBuiltinFieldEditors(): void {
  registerFieldEditor({ id: 'icon', order: 0, matches: isIconRow, component: IconEditor })
  registerFieldEditor({ id: 'bool', order: 10, matches: (r) => r.kind === 'bool', component: BoolEditor })
  registerFieldEditor({ id: 'enum', order: 10, matches: (r) => r.kind === 'enum', component: EnumEditor })
  registerFieldEditor({ id: 'reference', order: 10, matches: (r) => r.kind === 'reference', component: ReferenceEditor })
  registerFieldEditor({ id: 'linked', order: 10, matches: (r) => r.kind === 'linked', component: LinkedEditor })
  registerFieldEditor({ id: 'list', order: 10, matches: (r) => r.kind === 'list' || r.kind === 'object', component: ListEditor })
  registerFieldEditor({ id: 'text', order: 100, matches: () => true, component: TextEditor })
  registerFieldAction({ id: 'image', matches: isImageRow, component: ImageAction })
  registerFieldAction({ id: 'icon', matches: isIconRow, component: IconAction })
  registerFieldAction({ id: 'config', matches: (r, ctx) => ctx.canEditConfig && CONFIG_PATH_ROWS.includes(r.name), component: ConfigAction })
}
