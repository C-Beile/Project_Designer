import { useSyncExternalStore } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { getDialog, registerDialog } from '../plugins/registry'
import { FormDialog, type FormDialogProps } from './FormDialog'
import { ListDialog, type ListDialogProps } from './ListDialog'

// Masken als Daten: ein Plugin beschreibt einen Dialog mit defineFormDialog / defineListDialog,
// meldet ihn mit registerUiDialog an und die UI öffnet ihn mit openUiDialog. Der Host
// (UiDialogHost, hängt in DialogHost aus dialogService) zeigt offene Masken; sie schließen sich
// nach erfolgreichem OK und bei Abbrechen. Wirft onSubmit, bleibt die Maske offen.

export type FormDialogSpec = { kind: 'form' } & Omit<FormDialogProps, 'onCancel'>
export type ListDialogSpec<T = unknown> = { kind: 'list' } & Omit<ListDialogProps<T>, 'onCancel'>
export type UiDialogSpec = FormDialogSpec | ListDialogSpec<any>

export function defineFormDialog(spec: Omit<FormDialogSpec, 'kind'>): FormDialogSpec {
  return { kind: 'form', ...spec }
}

export function defineListDialog<T = unknown>(spec: Omit<ListDialogSpec<T>, 'kind'>): ListDialogSpec<T> {
  return { kind: 'list', ...spec }
}

/** Baut die Maske zur Beschreibung; `close` schließt sie. */
export function renderUiDialog(spec: UiDialogSpec, close: () => void): ReactNode {
  if (spec.kind === 'form') {
    const { kind: _k, onSubmit, ...rest } = spec
    return (
      <FormDialog
        {...rest}
        onSubmit={async (values) => {
          await onSubmit(values)
          close()
        }}
        onCancel={close}
      />
    )
  }
  const { kind: _k, onPick, ...rest } = spec
  return (
    <ListDialog
      {...rest}
      onPick={(picked) => {
        onPick(picked)
        close()
      }}
      onCancel={close}
    />
  )
}

/** Meldet eine Maske im Dialog-Register an; die Komponente bekommt `onClose`. */
export function registerUiDialog(id: string, spec: UiDialogSpec, plugin?: string): () => void {
  const component: ComponentType<{ onClose: () => void }> = ({ onClose }) => <>{renderUiDialog(spec, onClose)}</>
  return registerDialog({ id, plugin, component })
}

// ---------- Host ----------

interface Open {
  key: number
  render: (close: () => void) => ReactNode
}

let opened: Open[] = []
let nextKey = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => opened

/** Öffnet eine Maske (Beschreibung) oder eine im Register angemeldete Id. Gibt die Schließen-Funktion zurück. */
export function openUiDialog(target: UiDialogSpec | string, props: Record<string, unknown> = {}): () => void {
  let render: Open['render']
  if (typeof target === 'string') {
    const entry = getDialog(target)
    if (!entry) return () => {}
    const Component = entry.component
    render = (close) => <Component {...props} onClose={close} />
  } else {
    render = (close) => renderUiDialog(target, close)
  }
  const item: Open = { key: nextKey++, render }
  opened = [...opened, item]
  emit()
  return () => {
    if (!opened.includes(item)) return
    opened = opened.filter((o) => o !== item)
    emit()
  }
}

export function UiDialogHost() {
  const list = useSyncExternalStore(subscribe, snapshot)
  const top = list[list.length - 1]
  if (!top) return null
  const close = () => {
    opened = opened.filter((o) => o !== top)
    emit()
  }
  return <div key={top.key}>{top.render(close)}</div>
}

/** Nur für Tests: schließt alle offenen Masken. */
export function _resetUiDialogsForTests(): void {
  opened = []
  emit()
}
