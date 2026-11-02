import { useState, useSyncExternalStore } from 'react'
import { Modal } from './Dialogs'

// In-app replacement for window.confirm: a promise-based question shown as a modal inside the
// window. A second request with the same text while the first is still open joins the first one,
// so one action never produces two identical dialogs.

export interface ConfirmOptions {
  title?: string
  okLabel?: string
  cancelLabel?: string
}

export interface Choice {
  id: string
  label: string
}

interface PromptSpec {
  initial: string
  label?: string
  validate?: (value: string) => string | null
}

interface Answer {
  id: string | null
  value: string
}

interface Pending {
  message: string
  title?: string
  choices: Choice[]
  prompt?: PromptSpec
  promise: Promise<Answer>
  resolve: (answer: Answer) => void
}

let queue: Pending[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Pending | null {
  return queue[0] ?? null
}

function enqueue(message: string, choices: Choice[], title?: string, prompt?: PromptSpec): Promise<Answer> {
  const existing = queue.find((p) => p.message === message && p.title === title)
  if (existing) return existing.promise
  let resolve!: (a: Answer) => void
  const promise = new Promise<Answer>((r) => {
    resolve = r
  })
  queue = [...queue, { message, title, choices, prompt, promise, resolve }]
  emit()
  return promise
}

/** Asks with freely named buttons; the first one is the default (Enter), Escape answers null. */
export async function choiceDialog(message: string, choices: Choice[], title?: string): Promise<string | null> {
  return (await enqueue(message, choices, title)).id
}

export async function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const a = await enqueue(message, [{ id: 'ok', label: options.okLabel ?? 'OK' }, { id: 'cancel', label: options.cancelLabel ?? 'Cancel' }], options.title)
  return a.id === 'ok'
}

/** One text field with OK and Cancel; null when cancelled. `validate` returns an error text or null. */
export async function promptDialog(message: string, options: ConfirmOptions & { initial?: string; label?: string; validate?: (value: string) => string | null } = {}): Promise<string | null> {
  const a = await enqueue(message, [{ id: 'ok', label: options.okLabel ?? 'OK' }, { id: 'cancel', label: options.cancelLabel ?? 'Cancel' }], options.title, {
    initial: options.initial ?? '',
    label: options.label,
    validate: options.validate,
  })
  return a.id === 'ok' ? a.value : null
}

function answer(pending: Pending, id: string | null, value = '') {
  queue = queue.filter((p) => p !== pending)
  pending.resolve({ id, value })
  emit()
}

function PromptField({ spec, value, onChange }: { spec: PromptSpec; value: string; onChange: (v: string) => void }) {
  const issue = spec.validate?.(value) ?? null
  return (
    <>
      <label className="forge-field">
        {spec.label ? <span>{spec.label}</span> : null}
        <input type="text" value={value} aria-label={spec.label ?? 'Value'} autoFocus onChange={(e) => onChange(e.target.value)} />
      </label>
      {issue ? <p className="forge-field-error">{issue}</p> : null}
    </>
  )
}

function PendingDialog({ pending }: { pending: Pending }) {
  const [value, setValue] = useState(pending.prompt?.initial ?? '')
  const issue = pending.prompt?.validate?.(value) ?? null
  const okId = pending.choices[0].id
  const submit = () => {
    if (pending.prompt && (issue || value.trim() === '')) return
    answer(pending, okId, value)
  }
  const [first, ...rest] = pending.message.split(String.fromCharCode(10, 10))
  return (
    <Modal
      title={pending.title ?? 'Vendira Designer'}
      onClose={() => answer(pending, null)}
      onEnter={submit}
      footer={
        <>
          {pending.choices.map((c, i) => (
            <button key={c.id} type="button" disabled={i === 0 && !!pending.prompt && (!!issue || value.trim() === '')} onClick={() => (i === 0 ? submit() : answer(pending, c.id, value))}>
              {c.label}
            </button>
          ))}
        </>
      }
    >
      <p>{first}</p>
      {rest.map((r, i) => (
        <p key={i} className="forge-field-hint">
          {r}
        </p>
      ))}
      {pending.prompt ? <PromptField spec={pending.prompt} value={value} onChange={setValue} /> : null}
    </Modal>
  )
}

export function DialogHost() {
  const pending = useSyncExternalStore(subscribe, snapshot)
  if (!pending) return null
  return <PendingDialog key={pending.message} pending={pending} />
}

/** Test helper: drops every open question as declined. */
export function _resetDialogsForTests(): void {
  for (const p of queue) p.resolve({ id: null, value: '' })
  queue = []
  emit()
}
